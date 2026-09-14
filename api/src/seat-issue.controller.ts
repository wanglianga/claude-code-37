import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { DbService } from './db.service';
import { AuthGuard, Roles } from './auth.guard';
import { SeatIssue, SeatIssueType, UserRole } from './entities';

const STAFF: UserRole[] = ['staff', 'admin', 'volunteer', 'security'];
const OFFICER: UserRole[] = ['staff', 'admin'];

@Controller()
@UseGuards(AuthGuard)
export class SeatIssueController {
  constructor(private db: DbService) {}

  @Get('seat-issues')
  async list(@Req() req: any, @Query('date') date?: string, @Query('status') status?: string) {
    const day = date || DbService.todayStr();
    const qb = this.db.seatIssues.createQueryBuilder('i')
      .leftJoinAndSelect('i.student', 'student')
      .leftJoinAndSelect('i.seat', 'seat')
      .where('i.date = :day', { day })
      .orderBy('i.createdAt', 'DESC');
    if (status && status !== 'all') qb.andWhere('i.status = :status', { status });
    if (req.user.role === 'parent') {
      qb.andWhere('student.parent_id = :pid', { pid: req.user.sub });
    }
    const rows = await qb.getMany();
    return rows.map(i => ({
      id: i.id, date: i.date, type: i.type, title: i.title, status: i.status,
      studentId: i.studentId, studentName: i.student?.name, grade: i.student?.grade,
      seatId: i.seatId, seatCode: i.seat?.code, zone: i.seat?.zone,
      newSeatId: i.newSeatId, involvesBlindSpot: i.involvesBlindSpot,
      itemFound: i.itemFound, parentNotified: i.parentNotified,
      reportedByName: i.reportedByName, resolution: i.resolution,
      createdAt: i.createdAt, resolvedAt: i.resolvedAt,
    }));
  }

  @Get('seat-issues/:id')
  async detail(@Param('id') id: number, @Req() req: any) {
    const issue = await this.db.seatIssues.findOne({
      where: { id: Number(id) },
      relations: ['student', 'seat', 'newSeat', 'actions'],
      order: { actions: { time: 'ASC' } },
    });
    if (!issue) throw new NotFoundException('事件不存在');
    if (req.user.role === 'parent' && issue.student.parentId !== req.user.sub) {
      throw new ForbiddenException('无权访问该事件');
    }
    const focuses = await this.db.patrolFocuses.find({
      where: { seatIssueId: issue.id }, order: { createdAt: 'ASC' },
    });
    const maintenances = await this.db.maintenanceItems.find({
      where: { seatIssueId: issue.id }, order: { createdAt: 'ASC' },
    });
    return this.toDetail(issue, focuses, maintenances);
  }

  /** 学生反映座位被占/物品丢失：自动关联入场时间、座位、监控覆盖、同桌、巡查与临时离场 */
  @Roles(...STAFF)
  @Post('seat-issues')
  async report(@Req() req: any, @Body() body: {
    reservationId: number; type: SeatIssueType; title: string; description?: string;
  }) {
    if (!['seat_conflict', 'item_lost'].includes(body.type)) throw new BadRequestException('事件类型不合法');
    if (!body.title?.trim()) throw new BadRequestException('请填写事件标题');
    const r = await this.db.reservations.findOne({
      where: { id: Number(body.reservationId) }, relations: ['student', 'seat', 'room'],
    });
    if (!r) throw new NotFoundException('预约不存在');
    if (r.status !== 'checked_in') throw new BadRequestException('学生当前不在场，不能上报座位事件');
    if (!r.seatId) throw new BadRequestException('该预约尚未分配座位');

    const seat = r.seat!;
    const context = await this.buildContext(r.id, r.date);
    const issue = await this.db.ds.transaction(async manager => {
      const saved = await manager.save(this.db.seatIssues.create({
        date: r.date, type: body.type, title: body.title.trim(), description: body.description || '',
        status: 'responding', reservationId: r.id, studentId: r.studentId,
        seatId: r.seatId!, roomId: r.roomId ?? seat.roomId,
        involvesBlindSpot: !seat.monitored,
        reportedByName: req.user.name,
        context,
      }));
      await manager.save(this.db.seatIssueActions.create({
        issueId: saved.id, type: 'report', actorName: req.user.name, actorRole: req.user.role,
        time: DbService.nowShanghai(),
        detail: `${req.user.name} 上报：${body.title}；座位 ${seat.code}（${this.zoneLabel(seat.zone)}，${seat.monitored ? '监控覆盖' : '监控盲区'}）`,
      }));
      return saved;
    });
    return this.detail(issue.id, req);
  }

  /** 工作人员调整座位；调座后把陪读区、监控盲区、临时离场记录纳入当晚巡查 */
  @Roles(...OFFICER, 'security')
  @Post('seat-issues/:id/reassign')
  async reassign(@Param('id') id: number, @Req() req: any, @Body() body: { newSeatId?: number; note?: string }) {
    const issue = await this.getOr404(id);
    this.assertOpen(issue);
    const r = await this.db.reservations.findOne({
      where: { id: issue.reservationId }, relations: ['student', 'seat'],
    });
    if (!r) throw new NotFoundException('预约不存在');

    let target = body.newSeatId
      ? await this.db.seats.findOne({ where: { id: Number(body.newSeatId) }, relations: ['room'] })
      : null;
    if (!target) {
      // 自动分配一个空闲、优先监控覆盖的座位
      const occupied = await this.db.reservations.find({
        where: { date: issue.date, status: In(['checked_in']) },
      });
      const used = new Set(occupied.map(x => x.seatId).filter(Boolean));
      used.delete(issue.seatId);
      const free = (await this.db.seats.find({ relations: ['room'] }))
        .filter(s => s.room.active && !used.has(s.id));
      free.sort((a, b) => (b.monitored ? 1 : 0) - (a.monitored ? 1 : 0) || a.code.localeCompare(b.code));
      target = free[0];
      if (!target) throw new BadRequestException('没有可调整的空闲座位');
    } else {
      const conflict = await this.db.reservations.findOne({
        where: { date: issue.date, seatId: target.id, status: In(['checked_in']) },
      });
      if (conflict && conflict.id !== r.id) throw new BadRequestException(`座位 ${target.code} 已被占用`);
    }

    const oldSeat = issue.seatId ? await this.db.seats.findOneBy({ id: issue.seatId }) : null;
    // 用 update 更新外键，避免带 seat 关联保存时被旧关联覆盖
    await this.db.reservations.update(r.id, { seatId: target.id, roomId: target.roomId });
    issue.newSeatId = target.id; issue.seatId = target.id; issue.roomId = target.roomId;
    issue.involvesBlindSpot = issue.involvesBlindSpot || !target.monitored || !(oldSeat?.monitored ?? true);
    // 同步刷新现场上下文：当前座位更新为新座位，原始座位保留为证据
    if (issue.context) {
      issue.context.originalSeat = issue.context.originalSeat || issue.context.seat;
      issue.context.seat = {
        id: target.id, code: target.code, zone: target.zone, monitored: target.monitored,
        roomId: target.roomId, roomName: (target as any).room?.name,
      };
      issue.context.reassignedFrom = oldSeat ? oldSeat.code : null;
    }
    await this.db.seatIssues.save(issue);
    await this.addAction(id, 'reassign', req,
      `座位 ${oldSeat?.code || '—'} → ${target.code}（${this.zoneLabel(target.zone)}，${target.monitored ? '监控覆盖' : '监控盲区'}）${body.note ? '：' + body.note : ''}`);

    // 调座联动：陪读区（低龄/新分区）、监控盲区、该生临时离场记录纳入当晚巡查
    const ctx = issue.context || {};
    const focusAreas: string[] = [];
    if (target.zone === 'junior' || (oldSeat as any)?.zone === 'junior' || (r.student.grade <= 3)) {
      focusAreas.push('低龄陪读区');
    }
    if (!target.monitored || !(oldSeat?.monitored ?? true)) focusAreas.push('监控盲区');
    const tempOut = (ctx.tempOuts || []) as any[];
    if (tempOut.length) focusAreas.push(`该生临时离场路线（${tempOut.length} 次记录）`);
    if (!focusAreas.length) focusAreas.push(`${this.zoneLabel(target.zone)}（调座区域）`);
    for (const area of focusAreas) {
      await this.addFocusOnce(issue.id, {
        date: issue.date, area, zone: target.zone, roomId: target.roomId,
        frequencyMinutes: 20, reason: `座位调整联动（事件 #${issue.id}）：${area}`,
        createdByName: req.user.name,
      });
    }
    return this.detail(issue.id, req);
  }

  /** 发起寻物：志愿者/安保介入，登记物品特征 */
  @Roles(...STAFF)
  @Post('seat-issues/:id/start-search')
  async startSearch(@Param('id') id: number, @Req() req: any, @Body() body: { itemName?: string; note?: string }) {
    const issue = await this.getOr404(id);
    this.assertOpen(issue);
    if (issue.type !== 'item_lost') throw new BadRequestException('仅物品遗失事件可发起寻物');
    issue.status = 'responding';
    await this.db.seatIssues.save(issue);
    await this.addAction(id, 'start_search', req,
      `发起寻物${body.itemName ? '：' + body.itemName : ''}${body.note ? '（' + body.note + '）' : ''}；已安排查看监控与询问同桌`);
    const seat = await this.db.seats.findOneBy({ id: issue.seatId });
    await this.addFocusOnce(issue.id, {
      date: issue.date, area: `${this.zoneLabel(seat?.zone)}寻物排查`, zone: seat?.zone || '',
      roomId: issue.roomId, frequencyMinutes: 15,
      reason: `物品遗失寻物（事件 #${issue.id}）`, createdByName: req.user.name,
    });
    return this.detail(issue.id, req);
  }

  /** 联系家长 */
  @Roles(...STAFF)
  @Post('seat-issues/:id/contact-parent')
  async contactParent(@Param('id') id: number, @Req() req: any, @Body() body: { note: string; reached?: boolean }) {
    const issue = await this.getOr404(id);
    this.assertOpen(issue);
    if (!body.note?.trim()) throw new BadRequestException('请填写联系情况');
    issue.parentNotified = true;
    await this.db.seatIssues.save(issue);
    await this.addAction(id, 'contact_parent', req,
      `${body.reached === false ? '未接通' : '已联系家长'}：${body.note}`);
    return this.detail(issue.id, req);
  }

  @Post('seat-issues/:id/parent-reply')
  async parentReply(@Param('id') id: number, @Req() req: any, @Body() body: { content: string }) {
    const issue = await this.getOr404(id);
    this.assertOpen(issue);
    if (req.user.role === 'parent' && issue.student.parentId !== req.user.sub) throw new ForbiddenException();
    if (!body.content?.trim()) throw new BadRequestException('回复内容不能为空');
    issue.parentReply = body.content.trim();
    await this.db.seatIssues.save(issue);
    await this.addAction(id, 'parent_reply', req, body.content.trim());
    return this.detail(issue.id, req);
  }

  /** 结案：提频座位区巡查；涉及监控盲区的自动生成维护预算项；同步盲区整改 */
  @Roles(...OFFICER, 'security')
  @Post('seat-issues/:id/resolve')
  async resolve(@Param('id') id: number, @Req() req: any, @Body() body: {
    resolution: string; itemFound?: boolean; boostFrequency?: number;
  }) {
    const issue = await this.getOr404(id);
    this.assertOpen(issue);
    const now = DbService.nowShanghai();
    issue.status = 'resolved';
    issue.resolvedAt = now;
    issue.resolution = body.resolution || (issue.type === 'item_lost' ? '寻物结束' : '座位冲突处置完毕');
    issue.itemFound = issue.type === 'item_lost' ? !!body.itemFound : issue.itemFound;
    issue.boostedZone = (await this.db.seats.findOneBy({ id: issue.seatId }))?.zone || '';
    await this.db.seatIssues.save(issue);

    const seat = await this.db.seats.findOneBy({ id: issue.seatId });
    // 1) 结案后提高该区域巡查频次（默认 20 分钟一次）
    const freq = body.boostFrequency || 20;
    await this.addFocusOnce(issue.id, {
      date: issue.date, area: `${this.zoneLabel(seat?.zone)}座位区加强巡查`, zone: seat?.zone || '',
      roomId: issue.roomId, frequencyMinutes: freq,
      reason: `事件 #${issue.id} 结案后加强巡查`, createdByName: req.user.name,
    });

    // 2) 座位事件涉及监控盲区 → 盲区整改进入场地维护预算（按事件幂等，仅生成一次）
    let maintenanceId: number | undefined;
    const blindRelated = issue.involvesBlindSpot || !seat?.monitored;
    const existingMaint = await this.db.maintenanceItems.findOne({ where: { seatIssueId: issue.id } });
    if (blindRelated && (issue.type === 'item_lost' || issue.type === 'seat_conflict') && !existingMaint) {
      const item = await this.db.maintenanceItems.save(this.db.maintenanceItems.create({
        title: `监控盲区整改：${this.zoneLabel(seat?.zone)} ${seat?.code || ''} 周边补装监控`,
        area: `${this.zoneLabel(seat?.zone)}`, zone: seat?.zone || '',
        description: `座位事件 #${issue.id}《${issue.title}》暴露出监控覆盖不足，申请补装/调整摄像头。`,
        category: 'monitor_blind_spot', estimatedCost: 2800, status: 'proposed',
        seatIssueId: issue.id, proposedByName: req.user.name,
      }));
      maintenanceId = item.id;
    } else if (existingMaint) {
      maintenanceId = existingMaint.id;
    }

    await this.addAction(id, 'resolve', req,
      `${issue.resolution}；该区域巡查提频至每 ${freq} 分钟一次${maintenanceId ? `；已生成监控盲区维护预算项 #${maintenanceId}` : ''}`);
    return this.detail(issue.id, req);
  }

  // ---------- 巡查重点 / 维护预算 ----------
  @Get('patrol-focuses')
  listFocuses(@Query('date') date?: string) {
    return this.db.patrolFocuses.find({
      where: { date: date || DbService.todayStr() }, order: { createdAt: 'DESC' },
    });
  }

  @Get('maintenance')
  @Roles('staff', 'admin', 'security', 'volunteer')
  listMaintenance(@Query('status') status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.db.maintenanceItems.find({ where, order: { createdAt: 'DESC' } });
  }

  @Roles('admin', 'staff')
  @Post('maintenance/:id/approve')
  async approve(@Param('id') id: number, @Req() req: any, @Body() body: { estimatedCost?: number }) {
    const m = await this.db.maintenanceItems.findOneBy({ id: Number(id) });
    if (!m) throw new NotFoundException('预算项不存在');
    m.status = 'approved'; m.approvedByName = req.user.name; m.approvedAt = DbService.nowShanghai();
    if (body.estimatedCost != null) m.estimatedCost = body.estimatedCost;
    await this.db.maintenanceItems.save(m);
    return m;
  }

  @Roles('admin', 'staff')
  @Post('maintenance/:id/reject')
  async reject(@Param('id') id: number, @Req() req: any, @Body() body: { reason?: string }) {
    const m = await this.db.maintenanceItems.findOneBy({ id: Number(id) });
    if (!m) throw new NotFoundException('预算项不存在');
    m.status = 'rejected';
    m.description = `${m.description}\n驳回原因（${req.user.name}）：${body.reason || '—'}`;
    await this.db.maintenanceItems.save(m);
    return m;
  }

  // ---------- 内部 ----------
  private async buildContext(reservationId: number, date: string) {
    const r = await this.db.reservations.findOne({
      where: { id: reservationId }, relations: ['student', 'seat', 'room'],
    });
    const seat = r!.seat!;
    const neighbors = await this.db.neighborStudents(seat, date, reservationId);
    const start = new Date(`${date}T00:00:00+08:00`);
    const end = new Date(`${date}T23:59:59+08:00`);
    const patrols = await this.db.patrols.createQueryBuilder('p')
      .where('p.time BETWEEN :s AND :e', { s: start, e: end })
      .andWhere('(p.room_id = :rid OR p.area LIKE :z)', { rid: seat.roomId, z: `%${seat.code.split('-')[0]}%` })
      .orderBy('p.time', 'DESC').limit(10).getMany();
    const tempOuts = await this.db.studyEvents.find({
      where: { reservationId, type: In(['temp_out', 'returned', 'leave_seat']) as any },
      order: { occurredAt: 'DESC' },
    });
    const shifts = await this.db.shifts.find({ where: { date }, relations: ['volunteer'] });
    return {
      builtAt: DbService.nowShanghai(),
      checkIn: {
        at: r!.checkedInAt, arrivalSlot: r!.arrivalSlot, operator: r!.checkInOperator,
        authVerified: r!.authVerified, belongingsChecked: r!.belongingsChecked,
      },
      seat: {
        id: seat.id, code: seat.code, zone: seat.zone, monitored: seat.monitored,
        roomName: r!.room?.name, roomId: seat.roomId,
      },
      neighbors,
      patrols: patrols.map(p => ({ time: p.time, area: p.area, finding: p.finding, by: p.recorderName })),
      tempOuts: tempOuts.map(e => ({ type: e.type, detail: e.detail, at: e.occurredAt, by: e.recorderName })),
      volunteerShifts: shifts.map(s => ({
        volunteerName: s.volunteer?.name, startTime: s.startTime, endTime: s.endTime,
      })),
    };
  }

  private zoneLabel(z?: string) {
    return ({ junior: '低龄陪读区', quiet: '安静区', window: '临窗区', general: '普通区' } as any)[z || ''] || z || '座位区';
  }

  private async getOr404(id: number) {
    const issue = await this.db.seatIssues.findOne({
      where: { id: Number(id) }, relations: ['student'],
    });
    if (!issue) throw new NotFoundException('事件不存在');
    return issue;
  }
  private assertOpen(issue: any) {
    if (issue.status === 'resolved') {
      throw new ConflictException('事件已结案，不能重复处置（调座/寻物/结案等均不再生效，也不会重复生成巡查或预算）');
    }
  }
  /** 同一事件同一巡查重点只生成一次（按事件+区域去重） */
  private async addFocusOnce(issueId: number, data: any) {
    const dup = await this.db.patrolFocuses.findOne({
      where: { seatIssueId: issueId, area: data.area },
    });
    if (dup) return dup;
    return this.db.patrolFocuses.save(this.db.patrolFocuses.create({ ...data, seatIssueId: issueId }));
  }
  private async addAction(issueId: number, type: any, req: any, detail: string) {
    await this.db.seatIssueActions.save(this.db.seatIssueActions.create({
      issueId, type, actorName: req.user.name, actorRole: req.user.role,
      time: DbService.nowShanghai(), detail,
    }));
  }
  private async toDetail(issue: SeatIssue, focuses: any[], maintenances: any[]) {
    return {
      id: issue.id, date: issue.date, type: issue.type, title: issue.title,
      description: issue.description, status: issue.status,
      reservationId: issue.reservationId, studentId: issue.studentId,
      student: issue.student && {
        id: issue.student.id, name: issue.student.name, grade: issue.student.grade,
        parentId: issue.student.parentId,
      },
      seatId: issue.seatId, newSeatId: issue.newSeatId, roomId: issue.roomId,
      seat: issue.seat && { id: issue.seat.id, code: issue.seat.code, zone: issue.seat.zone, monitored: issue.seat.monitored },
      newSeat: (issue as any).newSeat ? {
        id: (issue as any).newSeat.id, code: (issue as any).newSeat.code,
        zone: (issue as any).newSeat.zone, monitored: (issue as any).newSeat.monitored,
      } : null,
      involvesBlindSpot: issue.involvesBlindSpot,
      parentNotified: issue.parentNotified, parentReply: issue.parentReply,
      itemFound: issue.itemFound, boostedZone: issue.boostedZone,
      resolution: issue.resolution, reportedByName: issue.reportedByName,
      resolvedAt: issue.resolvedAt, createdAt: issue.createdAt,
      context: issue.context,
      actions: (issue as any).actions?.map((a: any) => ({
        id: a.id, type: a.type, detail: a.detail, actorName: a.actorName, actorRole: a.actorRole, time: a.time,
      })) || [],
      patrolFocuses: focuses,
      maintenanceItems: maintenances,
    };
  }
}
