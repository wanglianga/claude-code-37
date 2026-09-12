import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { Between } from 'typeorm';
import { DbService } from './db.service';
import { AuthGuard, Roles } from './auth.guard';
import { IncidentType, IncidentStatus } from './entities';

const INCIDENT_TYPES: IncidentType[] = [
  'no_show', 'pickup_change', 'night_unpicked', 'conflict', 'device_lost', 'power_outage', 'late_return',
];

@Controller()
@UseGuards(AuthGuard)
export class CollaborationController {
  constructor(private db: DbService) {}

  // ---------- 协同事件：志愿者/社区/家长/安保围绕同一事件处理 ----------
  @Get('incidents')
  async list(@Req() req: any, @Query('date') date?: string, @Query('status') status?: string, @Query('studentId') studentId?: string) {
    const qb = this.db.incidents.createQueryBuilder('i')
      .leftJoinAndSelect('i.student', 'student')
      .orderBy('i.createdAt', 'DESC');
    if (date) qb.andWhere('i.date = :date', { date });
    if (status) qb.andWhere('i.status = :status', { status });
    if (studentId) qb.andWhere('i.student_id = :sid', { sid: Number(studentId) });
    // 家长只能看到与自己孩子相关的事件
    if (req.user.role === 'parent') {
      const kids = await this.db.students.find({ where: { parentId: req.user.sub } });
      qb.andWhere('i.student_id IN (:...kids)', { kids: kids.map(k => k.id) });
    }
    const rows = await qb.getMany();
    return rows.map(i => ({
      id: i.id, date: i.date, type: i.type, title: i.title, description: i.description,
      status: i.status, escalated: i.escalated, resolution: i.resolution,
      openedByName: i.openedByName, reservationId: i.reservationId, studentId: i.studentId,
      studentName: i.student?.name || null,
      messageCount: i.messages?.length || 0,
      createdAt: i.createdAt, resolvedAt: i.resolvedAt,
    }));
  }

  @Post('incidents')
  async open(@Req() req: any, @Body() body: {
    type: IncidentType; title: string; description?: string;
    reservationId?: number; studentId?: number; date?: string;
  }) {
    if (!INCIDENT_TYPES.includes(body.type)) throw new BadRequestException('事件类型不合法');
    if (!body.title) throw new BadRequestException('请填写事件标题');

    let studentId = body.studentId ? Number(body.studentId) : undefined;
    let reservationId = body.reservationId ? Number(body.reservationId) : undefined;

    // ---- 归属校验必须在任何写库之前完成，校验失败一律不落库 ----
    if (reservationId) {
      const r = await this.db.reservations.findOneBy({ id: reservationId });
      if (!r) throw new NotFoundException('预约不存在');
      if (req.user.role === 'parent' && r.parentId !== req.user.sub) {
        throw new ForbiddenException('只能为自己的预约发起协同事件');
      }
      studentId = r.studentId;
    }
    if (req.user.role === 'parent' && studentId) {
      const owns = await this.db.students.findOne({
        where: { id: studentId, parentId: req.user.sub },
      });
      if (!owns) throw new ForbiddenException('只能为自己的孩子发起协同事件');
    }

    // 事件 + 首条消息同一事务落库，避免状态与持久化不一致
    const inc = await this.db.ds.transaction(async manager => {
      const saved = await manager.save(this.db.incidents.create({
        type: body.type, title: body.title, description: body.description || '',
        date: body.date || DbService.todayStr(),
        reservationId, studentId,
        openedByName: req.user.name,
        status: 'open',
      }));
      await manager.save(this.db.incidentMessages.create({
        incidentId: saved.id, authorName: req.user.name, authorRole: req.user.role,
        content: `发起事件：${body.title}`,
      }));
      return saved;
    });
    // 高风险事件自动给当事学生累计异常分
    if (studentId && ['night_unpicked', 'conflict', 'device_lost', 'late_return'].includes(body.type)) {
      await this.db.addAbnormal(studentId, body.type === 'night_unpicked' ? 3 : 2);
    }
    return this.getOne(inc.id, req);
  }

  @Get('incidents/:id')
  async getOne(@Param('id') id: number, @Req() req: any) {
    const inc = await this.db.incidents.findOne({
      where: { id: Number(id) },
      relations: ['student', 'messages'],
      order: { messages: { createdAt: 'ASC' } },
    } as any);
    if (!inc) throw new NotFoundException('事件不存在');
    if (req.user.role === 'parent') {
      const owns = inc.studentId && (await this.db.students.findOne({
        where: { id: inc.studentId, parentId: req.user.sub },
      }));
      if (!owns) throw new NotFoundException('事件不存在');
    }
    return {
      id: inc.id, date: inc.date, type: inc.type, title: inc.title, description: inc.description,
      status: inc.status, escalated: inc.escalated, resolution: inc.resolution,
      openedByName: inc.openedByName, reservationId: inc.reservationId,
      student: inc.student ? { id: inc.student.id, name: inc.student.name, grade: inc.student.grade, watchlisted: inc.student.watchlisted } : null,
      messages: inc.messages.map(m => ({
        id: m.id, authorName: m.authorName, authorRole: m.authorRole,
        content: m.content, createdAt: m.createdAt,
      })),
      createdAt: inc.createdAt, resolvedAt: inc.resolvedAt,
    };
  }

  /** 家长只能访问自己孩子的事件 */
  private async assertIncidentAccess(inc: any, user: any) {
    if (user.role !== 'parent') return;
    const owns = inc.studentId && await this.db.students.findOne({
      where: { id: inc.studentId, parentId: user.sub },
    });
    if (!owns) throw new NotFoundException('事件不存在');
  }

  /** 任一参与角色在事件下发消息（处置进展 / 家长反馈 / 安保记录） */
  @Post('incidents/:id/messages')
  async addMessage(@Param('id') id: number, @Req() req: any, @Body() body: { content: string }) {
    const inc = await this.db.incidents.findOneBy({ id: Number(id) });
    if (!inc) throw new NotFoundException();
    await this.assertIncidentAccess(inc, req.user);
    if (!body.content?.trim()) throw new BadRequestException('消息内容不能为空');
    const msg = await this.db.incidentMessages.save(this.db.incidentMessages.create({
      incidentId: inc.id, authorName: req.user.name, authorRole: req.user.role, content: body.content,
    }));
    if (inc.status === 'open') { inc.status = 'responding'; await this.db.incidents.save(inc); }
    return msg;
  }

  @Roles('staff', 'admin', 'volunteer', 'security')
  @Post('incidents/:id/escalate')
  async escalate(@Param('id') id: number, @Req() req: any, @Body() body: { note?: string }) {
    const inc = await this.db.incidents.findOneBy({ id: Number(id) });
    if (!inc) throw new NotFoundException();
    inc.escalated = true;
    if (inc.status === 'open') inc.status = 'responding';
    await this.db.incidents.save(inc);
    await this.db.incidentMessages.save(this.db.incidentMessages.create({
      incidentId: inc.id, authorName: req.user.name, authorRole: req.user.role,
      content: `已升级，通知社区负责人与安保联动。${body.note || ''}`,
    }));
    return this.getOne(inc.id, req);
  }

  @Roles('staff', 'admin', 'volunteer', 'security')
  @Post('incidents/:id/resolve')
  async resolve(@Param('id') id: number, @Req() req: any, @Body() body: { resolution?: string }) {
    const inc = await this.db.incidents.findOneBy({ id: Number(id) });
    if (!inc) throw new NotFoundException();
    inc.status = 'resolved' as IncidentStatus;
    inc.resolution = body.resolution || '现场处置完毕';
    inc.resolvedAt = DbService.nowShanghai();
    await this.db.incidents.save(inc);
    await this.db.incidentMessages.save(this.db.incidentMessages.create({
      incidentId: inc.id, authorName: req.user.name, authorRole: req.user.role,
      content: `事件关闭：${inc.resolution}`,
    }));
    return this.getOne(inc.id, req);
  }

  // ---------- 安全巡查 ----------
  @Roles('security', 'staff', 'admin', 'volunteer')
  @Get('patrols')
  listPatrols(@Query('date') date?: string) {
    const day = date || DbService.todayStr();
    const start = new Date(`${day}T00:00:00+08:00`);
    const end = new Date(`${day}T23:59:59+08:00`);
    return this.db.patrols.find({
      where: { time: Between(start, end) },
      relations: ['room'], order: { time: 'DESC' },
    }).then(rows => rows.map(p => ({
      id: p.id, time: p.time, area: p.area, finding: p.finding, normal: p.normal,
      roomName: p.room?.name || null, recorderName: p.recorderName,
    })));
  }

  @Post('patrols')
  async addPatrol(@Req() req: any, @Body() body: { area: string; finding?: string; normal?: boolean; roomId?: number }) {
    if (!body.area) throw new BadRequestException('请填写巡查区域');
    return this.db.patrols.save(this.db.patrols.create({
      time: DbService.nowShanghai(),
      area: body.area, finding: body.finding || '',
      normal: body.normal !== false,
      roomId: body.roomId ? Number(body.roomId) : undefined,
      recorderName: req.user.name,
    }));
  }
}
