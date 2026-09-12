import { Body, Controller, Get, Post, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { DbService } from './db.service';
import { AuthGuard, Roles } from './auth.guard';

@Controller()
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(private db: DbService) {}

  /** 前端一次性拉取基础数据 */
  @Get('meta')
  async meta(@Req() req: any, @Query('date') date?: string) {
    const day = date || DbService.todayStr();
    const studentWhere: any = {};
    if (req.user.role === 'parent') studentWhere.parentId = req.user.sub;
    const [students, rooms, schedules, shifts] = await Promise.all([
      this.db.students.find({ where: studentWhere, order: { grade: 'ASC' } }),
      this.db.rooms.find({ where: { active: true }, relations: ['seats'], order: { id: 'ASC' } }),
      this.db.schedules.find({ where: { active: true }, order: { weekday: 'ASC' } }),
      this.db.shifts.find({ where: { date: day }, relations: ['volunteer'], order: { startTime: 'ASC' } }),
    ]);
    const seats = rooms.flatMap(r => r.seats.map(s => ({ ...s, roomName: r.name })));
    const reserved = await this.db.reservations.find({
      where: [{ date: day, status: 'confirmed' }, { date: day, status: 'pending' }, { date: day, status: 'checked_in' }],
    });
    const reservedSeatMap: Record<number, any> = {};
    for (const r of reserved) if (r.seatId) reservedSeatMap[r.seatId] = { reservationId: r.id, status: r.status, studentId: r.studentId };
    return {
      today: day,
      students: students.map(s => ({ ...s, passwordHash: undefined })),
      rooms: rooms.map(({ seats: _s, ...r }) => r),
      seats: seats.map(s => ({ ...s, reservation: reservedSeatMap[s.id] || null })),
      schedules, shifts: shifts.map(s => ({ ...s, volunteerName: s.volunteer?.name })),
    };
  }

  @Get('students')
  async listStudents(@Req() req: any) {
    const where: any = {};
    if (req.user.role === 'parent') where.parentId = req.user.sub;
    const list = await this.db.students.find({ where, order: { id: 'ASC' } });
    return list;
  }

  @Post('students')
  async createStudent(@Req() req: any, @Body() body: any) {
    if (req.user.role === 'parent') body.parentId = req.user.sub;
    if (!body.parentId) throw new ForbiddenException('缺少家长');
    const s = this.db.students.create({
      name: body.name, grade: Number(body.grade), school: body.school || '社区学校',
      parentId: body.parentId, allergies: body.allergies || '', careNeeds: body.careNeeds || '',
      emergencyContact: body.emergencyContact || '', emergencyPhone: body.emergencyPhone || '',
    });
    return this.db.students.save(s);
  }

  // ---------- 管理员配置：自习室 / 座位 / 开放时间 / 排班 ----------
  @Roles('admin', 'staff')
  @Post('rooms')
  async addRoom(@Body() body: any) {
    return this.db.rooms.save(this.db.rooms.create({ name: body.name, capacity: Number(body.capacity) }));
  }

  @Roles('admin', 'staff')
  @Post('seats')
  async addSeat(@Body() body: any) {
    return this.db.seats.save(this.db.seats.create({
      code: body.code, zone: body.zone, monitored: body.monitored !== false, roomId: Number(body.roomId),
    }));
  }

  @Roles('admin', 'staff')
  @Post('schedules')
  async addSchedule(@Body() body: any) {
    return this.db.schedules.save(this.db.schedules.create({
      weekday: Number(body.weekday), openTime: body.openTime, closeTime: body.closeTime,
      soloLeaveDeadline: body.soloLeaveDeadline || null,
    }));
  }

  @Roles('admin', 'staff')
  @Post('shifts')
  async addShift(@Body() body: any) {
    return this.db.shifts.save(this.db.shifts.create({
      date: body.date, startTime: body.startTime, endTime: body.endTime,
      volunteerId: Number(body.volunteerId), careCapacity: Number(body.careCapacity || 12),
    }));
  }

  @Get('volunteers')
  @Roles('admin', 'staff')
  listVolunteers() {
    return this.db.users.find({ where: { role: 'volunteer' } });
  }
}
