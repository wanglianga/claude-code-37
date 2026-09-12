import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { DbService } from './db.service';
import { AuthGuard, Roles } from './auth.guard';
import { StudyEventType } from './entities';

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function toMin(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

@Controller('reservations')
@UseGuards(AuthGuard)
export class ReservationController {
  constructor(private db: DbService) {}

  /** 家长提交预约：校验社区开放时间、志愿者排班容量、自习室座位容量、低龄晚间独自离场限制 */
  @Post()
  async create(@Req() req: any, @Body() body: any) {
    if (req.user.role !== 'parent') throw new ForbiddenException('仅家长可提交预约');
    const date = body.date || DbService.todayStr();
    const student = await this.db.students.findOneBy({ id: Number(body.studentId) });
    if (!student || student.parentId !== req.user.sub) throw new ForbiddenException('学生不存在或不属于该家长');

    const arrivalSlot: string = body.arrivalSlot;   // 如 18:00-18:30
    const plannedLeave: string = body.plannedLeave; // HH:mm
    const leaveMode = body.leaveMode === 'solo' ? 'solo' : 'pickup';
    if (!arrivalSlot || !plannedLeave) throw new BadRequestException('请填写到场时段与计划离场时间');
    if (leaveMode === 'solo' && student.soloPickupRestricted) {
      throw new BadRequestException(
        `该家庭已有 ${student.pickupRiskCount} 次晚间无人接处置记录，学生独自离场权限已被社区限制，请选择家长接，或联系社区工作人员解除限制`,
      );
    }
    const slotStart = toMin(arrivalSlot.split('-')[0]);
    const slotEnd = toMin(arrivalSlot.split('-')[1] || arrivalSlot.split('-')[0]);

    // 1) 社区开放时间（常规开放表；无常规开放但当天有志愿者排班，视为临时开放日）
    const schedule = await this.db.schedules.findOne({
      where: { weekday: weekdayOf(date), active: true },
    });
    const dayShifts = await this.db.shifts.find({ where: { date } });
    if (!schedule && !dayShifts.length) throw new BadRequestException('该日社区自习室不开放，请选择开放日');
    const shiftMinStart = dayShifts.length ? Math.min(...dayShifts.map(s => toMin(s.startTime))) : null;
    const shiftMaxEnd = dayShifts.length ? Math.max(...dayShifts.map(s => toMin(s.endTime))) : null;
    if (schedule) {
      if (slotStart < toMin(schedule.openTime) || toMin(plannedLeave) > toMin(schedule.closeTime)) {
        throw new BadRequestException(`预约时段须在开放时间 ${schedule.openTime}-${schedule.closeTime} 内`);
      }
    } else if (shiftMinStart !== null && (slotStart < shiftMinStart || toMin(plannedLeave) > shiftMaxEnd!)) {
      throw new BadRequestException('预约时段须在当日志愿者排班覆盖时间内');
    }

    // 2) 低龄学生晚间独自离场限制（临时开放日无专用截止时间时，取常规开放日最宽松截止兜底）
    let soloDeadline = schedule?.soloLeaveDeadline || null;
    if (!soloDeadline) {
      const actives = await this.db.schedules.find({ where: { active: true } });
      const deadlines = actives.map(s => s.soloLeaveDeadline).filter(Boolean) as string[];
      if (deadlines.length) soloDeadline = deadlines.sort().pop() || null;
    }
    if (leaveMode === 'solo' && soloDeadline && DbService.isJunior(student.grade)
      && toMin(plannedLeave) > toMin(soloDeadline)) {
      throw new BadRequestException(
        `低年级学生最晚须在 ${soloDeadline} 前独自离场，之后请改为家长接，或调整离场时间`,
      );
    }

    // 3) 志愿者排班容量：到场时刻须有在岗班次，且该班次看护名额未满
    const shifts = dayShifts;
    const shift = shifts.find(s => toMin(s.startTime) <= slotStart && slotStart <= toMin(s.endTime));
    if (!shift) throw new BadRequestException('到场时段没有志愿者排班，请更换时段');
    // 待重新确认（重点关注名单）的预约在家长确认前不占容量
    const dayRes = await this.db.reservations.find({
      where: { date, status: In(['confirmed', 'checked_in']) },
    });
    const shiftLoad = dayRes.filter(r => {
      const ss = toMin(r.arrivalSlot.split('-')[0]);
      return toMin(shift.startTime) <= ss && ss <= toMin(shift.endTime);
    }).length;
    if (shiftLoad >= shift.careCapacity) {
      throw new BadRequestException('该班次志愿者看护名额已满，请更换到场时段');
    }

    // 4) 自习室容量（座位总数）
    const totalSeats = await this.db.seats.count();
    if (dayRes.length >= totalSeats) throw new BadRequestException('自习室预约已达容量上限');

    // 5) 重点关注学生：预约进入待确认，需家长重新确认
    const watchlisted = student.watchlisted && !body.forceConfirm;

    const r = this.db.reservations.create({
      date, arrivalSlot, plannedLeave, leaveMode,
      studentId: student.id, parentId: student.parentId,
      emergencyContact: body.emergencyContact || student.emergencyContact,
      emergencyPhone: body.emergencyPhone || student.emergencyPhone,
      allergies: body.allergies || student.allergies,
      careNote: body.careNote || '',
      parentNote: body.parentNote || '',
      status: watchlisted ? 'pending' : 'confirmed',
      reconfirmed: !watchlisted,
    });
    const saved = await this.db.reservations.save(r);
    return this.detail(saved.id, req);
  }

  @Get()
  async list(@Req() req: any, @Query('date') date?: string, @Query('status') status?: string) {
    const day = date || DbService.todayStr();
    const where: any = { date: day };
    if (status) where.status = status;
    const qb = this.db.reservations
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.student', 'student')
      .leftJoinAndSelect('r.seat', 'seat')
      .leftJoinAndSelect('r.room', 'room')
      .where('r.date = :day', { day })
      .orderBy('r.arrivalSlot', 'ASC');
    if (status) qb.andWhere('r.status = :status', { status });
    if (req.user.role === 'parent') qb.andWhere('r.parent_id = :pid', { pid: req.user.sub });
    const rows = await qb.getMany();
    return rows.map(r => ({
      id: r.id, date: r.date, arrivalSlot: r.arrivalSlot, plannedLeave: r.plannedLeave,
      leaveMode: r.leaveMode, status: r.status, parentNote: r.parentNote,
      reconfirmed: r.reconfirmed, checkedInAt: r.checkedInAt, checkedOutAt: r.checkedOutAt,
      parentConfirmed: r.parentConfirmed, careNote: r.careNote,
      seat: r.seat ? { id: r.seat.id, code: r.seat.code, zone: r.seat.zone, monitored: r.seat.monitored } : null,
      roomName: r.room?.name || null,
      student: r.student && {
        id: r.student.id, name: r.student.name, grade: r.student.grade, school: r.student.school,
        allergies: r.student.allergies, careNeeds: r.student.careNeeds,
        emergencyContact: r.student.emergencyContact, emergencyPhone: r.student.emergencyPhone,
        watchlisted: r.student.watchlisted,
        pickupRiskCount: r.student.pickupRiskCount, soloPickupRestricted: r.student.soloPickupRestricted,
      },
    }));
  }

  @Get(':id')
  async detail(@Param('id') id: number, @Req() req: any) {
    const r = await this.db.reservations.findOne({
      where: { id: Number(id) },
      relations: ['student', 'seat', 'room'],
    });
    if (!r) throw new NotFoundException('预约不存在');
    if (req.user.role === 'parent' && r.parentId !== req.user.sub) throw new ForbiddenException();
    const events = await this.db.studyEvents.find({ where: { reservationId: r.id }, order: { occurredAt: 'ASC' } });
    const incidents = await this.db.incidents.find({ where: { reservationId: r.id }, order: { createdAt: 'ASC' } });
    const { student, seat, room, ...rest } = r as any;
    return {
      ...rest,
      student: student && {
        id: student.id, name: student.name, grade: student.grade, school: student.school,
        allergies: student.allergies, careNeeds: student.careNeeds, watchlisted: student.watchlisted,
        emergencyContact: student.emergencyContact, emergencyPhone: student.emergencyPhone,
        abnormalScore: student.abnormalScore,
        pickupRiskCount: student.pickupRiskCount, soloPickupRestricted: student.soloPickupRestricted,
      },
      seat: seat ? { id: seat.id, code: seat.code, zone: seat.zone, monitored: seat.monitored } : null,
      roomName: room?.name || null,
      events,
      incidents: incidents.map(i => ({ id: i.id, type: i.type, title: i.title, status: i.status, escalated: i.escalated })),
    };
  }

  /** 重点关注学生：家长重新确认预约 */
  @Post(':id/reconfirm')
  async reconfirm(@Param('id') id: number, @Req() req: any) {
    const r = await this.db.reservations.findOneBy({ id: Number(id) });
    if (!r) throw new NotFoundException();
    if (req.user.role !== 'parent' || r.parentId !== req.user.sub) throw new ForbiddenException();
    if (r.status !== 'pending') throw new BadRequestException('该预约无需重新确认');
    r.status = 'confirmed';
    r.reconfirmed = true;
    r.reconfirmedAt = new Date();
    await this.db.reservations.save(r);
    return this.detail(r.id, req);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: number, @Req() req: any) {
    const r = await this.db.reservations.findOneBy({ id: Number(id) });
    if (!r) throw new NotFoundException();
    if (req.user.role === 'parent' && r.parentId !== req.user.sub) throw new ForbiddenException();
    if (r.status === 'checked_in') throw new BadRequestException('已入场预约请先办理离场');
    r.status = 'cancelled';
    await this.db.reservations.save(r);
    return { ok: true };
  }

  /** 入场核验：预约 / 家长授权 / 随身物品 / 离场方式，通过后分配座位 */
  @Roles('staff', 'volunteer', 'admin')
  @Post(':id/check-in')
  async checkIn(@Param('id') id: number, @Req() req: any, @Body() body: any) {
    const r = await this.db.reservations.findOne({ where: { id: Number(id) }, relations: ['student'] });
    if (!r) throw new NotFoundException('预约不存在');
    if (!['confirmed', 'no_show'].includes(r.status)) throw new BadRequestException('当前状态不能入场');
    if (body.authVerified !== true) throw new BadRequestException('须先核验家长授权');
    if (body.belongingsChecked !== true) throw new BadRequestException('须核验随身物品');
    if (body.leaveModeVerified !== true) throw new BadRequestException('须确认离场方式');

    const seat = await this.db.allocateSeat(r.student, r.date, r.careNote, body.seatId ? Number(body.seatId) : undefined);
    r.status = 'checked_in';
    r.checkedInAt = DbService.nowShanghai();
    r.seatId = seat.id;
    r.roomId = seat.roomId;
    r.authVerified = true;
    r.belongingsChecked = true;
    r.leaveModeVerified = true;
    r.checkInOperator = req.user.name;
    r.checkInNote = body.note || '';
    await this.db.reservations.save(r);

    // 迟到判定：晚于到场时段起始 15 分钟
    const nowMin = DbService.nowShanghai().getHours() * 60 + DbService.nowShanghai().getMinutes();
    if (nowMin > toMin(r.arrivalSlot.split('-')[0]) + 15) {
      await this.db.studyEvents.save(this.db.studyEvents.create({
        reservationId: r.id, type: 'late',
        detail: `晚于 ${r.arrivalSlot} 到场，${req.user.name} 标记迟到`,
        occurredAt: DbService.nowShanghai(), recorderName: req.user.name,
      }));
      await this.db.addAbnormal(r.studentId, 1);
    }
    return this.detail(r.id, req);
  }

  /** 志愿者记录自习过程：迟到/离座/借充电器/临时外出/身体不适/家长留言/返回 */
  @Roles('staff', 'volunteer', 'admin')
  @Post(':id/events')
  async addEvent(@Param('id') id: number, @Req() req: any, @Body() body: { type: StudyEventType; detail?: string }) {
    const r = await this.db.reservations.findOneBy({ id: Number(id) });
    if (!r) throw new NotFoundException();
    if (r.status !== 'checked_in') throw new BadRequestException('仅自习中的预约可记录');
    const ev = await this.db.studyEvents.save(this.db.studyEvents.create({
      reservationId: r.id,
      type: body.type,
      detail: body.detail || '',
      occurredAt: DbService.nowShanghai(),
      recorderName: req.user.name,
    }));
    if (['late', 'temp_out', 'leave_seat', 'unwell'].includes(body.type)) {
      await this.db.addAbnormal(r.studentId, body.type === 'unwell' ? 0 : 1);
    }
    return ev;
  }

  /** 家长留言同步进自习记录 */
  @Post(':id/message')
  async parentMessage(@Param('id') id: number, @Req() req: any, @Body() body: { content: string }) {
    const r = await this.db.reservations.findOneBy({ id: Number(id) });
    if (!r) throw new NotFoundException();
    if (req.user.role !== 'parent' || r.parentId !== req.user.sub) throw new ForbiddenException();
    r.parentNote = [r.parentNote, body.content].filter(Boolean).join('\n');
    await this.db.reservations.save(r);
    if (r.status === 'checked_in') {
      await this.db.studyEvents.save(this.db.studyEvents.create({
        reservationId: r.id, type: 'parent_message', detail: body.content,
        occurredAt: DbService.nowShanghai(), recorderName: req.user.name,
      }));
    }
    return { ok: true };
  }

  /** 离场登记 */
  @Roles('staff', 'volunteer', 'security', 'admin')
  @Post(':id/check-out')
  async checkOut(@Param('id') id: number, @Req() req: any, @Body() body: { actualLeaveMode?: string }) {
    const r = await this.db.reservations.findOne({ where: { id: Number(id) }, relations: ['student'] });
    if (!r) throw new NotFoundException();
    if (r.status !== 'checked_in') throw new BadRequestException('当前状态不能离场');
    const mode = body.actualLeaveMode || r.leaveMode;
    const now = DbService.nowShanghai();

    let warning = '';
    const schedule = await this.db.schedules.findOne({
      where: { weekday: weekdayOf(r.date), active: true },
    });
    let soloDeadline = schedule?.soloLeaveDeadline || null;
    if (!soloDeadline) {
      const actives = await this.db.schedules.find({ where: { active: true } });
      const deadlines = actives.map(s => s.soloLeaveDeadline).filter(Boolean) as string[];
      soloDeadline = deadlines.sort().pop() || null;
    }
    if (mode === 'solo' && soloDeadline
      && DbService.isJunior(r.student.grade)
      && now.getHours() * 60 + now.getMinutes() > toMin(soloDeadline)) {
      warning = '已超低年级独自离场截止时间，应改为家长接；如已放行请发起协同事件备案';
      await this.db.addAbnormal(r.studentId, 2);
    }

    r.status = 'checked_out';
    r.checkedOutAt = now;
    r.actualLeaveMode = mode;
    r.checkOutOperator = req.user.name;
    await this.db.reservations.save(r);
    return { ...await this.detail(r.id, req), warning };
  }

  /** 家长离场电子确认 */
  @Post(':id/parent-confirm')
  async parentConfirm(@Param('id') id: number, @Req() req: any) {
    const r = await this.db.reservations.findOneBy({ id: Number(id) });
    if (!r) throw new NotFoundException();
    if (req.user.role !== 'parent' || r.parentId !== req.user.sub) throw new ForbiddenException();
    r.parentConfirmed = true;
    r.parentConfirmedAt = DbService.nowShanghai();
    await this.db.reservations.save(r);
    return { ok: true, confirmedAt: r.parentConfirmedAt };
  }
}
