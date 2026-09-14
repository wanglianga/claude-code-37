import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { DbService } from './db.service';
import { AuthGuard, Roles } from './auth.guard';
import { PickupCase, PickupActionType, UserRole } from './entities';

const STAFF_ROLES: UserRole[] = ['staff', 'admin', 'volunteer', 'security'];
const OFFICER_ROLES: UserRole[] = ['staff', 'admin']; // 社区值班人员可做处置决策/升级

@Controller()
@UseGuards(AuthGuard)
export class PickupController {
  constructor(private db: DbService) {}

  /** 列表：工作人员看全部；家长只看自己孩子 */
  @Get('pickup-cases')
  async list(@Req() req: any, @Query('date') date?: string, @Query('status') status?: string) {
    const day = date || DbService.todayStr();
    const qb = this.db.pickupCases.createQueryBuilder('c')
      .leftJoinAndSelect('c.student', 'student')
      .leftJoinAndSelect('c.reservation', 'reservation')
      .where('c.date = :day', { day })
      .orderBy('c.openedAt', 'DESC');
    if (status && status !== 'all') qb.andWhere('c.status = :status', { status });
    if (req.user.role === 'parent') qb.andWhere('reservation.parent_id = :pid', { pid: req.user.sub });
    const rows = await qb.getMany();
    return rows.map(c => ({
      id: c.id, date: c.date, status: c.status, studentId: c.studentId,
      studentName: c.student?.name, grade: c.gradeSnapshot,
      reservationId: c.reservationId,
      authorizedLeaveMode: c.authorizedLeaveMode,
      openedAt: c.openedAt, resolvedAt: c.resolvedAt,
      contactAttempts: c.contactAttempts, contactReached: c.contactReached,
      lastParentReply: c.lastParentReply,
      dutyStaffName: c.dutyStaffName, escortName: c.escortName,
      tempCareLocation: c.tempCareLocation, gridWorkerName: c.gridWorkerName,
      pickupPersonName: c.pickupPersonName,
      soloRestrictedAfter: c.soloRestrictedAfter,
      plannedLeave: c.reservation?.plannedLeave,
    }));
  }

  @Get('pickup-cases/:id')
  async detail(@Param('id') id: number, @Req() req: any) {
    const c = await this.db.pickupCases.findOne({
      where: { id: Number(id) },
      relations: ['student', 'actions', 'reservation'],
      order: { actions: { time: 'ASC' } },
    });
    if (!c) throw new NotFoundException('处置单不存在');
    await this.assertAccess(c, req.user);
    return {
      id: c.id, date: c.date, status: c.status,
      openedAt: c.openedAt, resolvedAt: c.resolvedAt,
      authorizedLeaveMode: c.authorizedLeaveMode, gradeSnapshot: c.gradeSnapshot,
      contactAttempts: c.contactAttempts, contactReached: c.contactReached,
      lastParentReply: c.lastParentReply, lastParentReplyAt: c.lastParentReplyAt,
      dutyStaffName: c.dutyStaffName, escortName: c.escortName,
      tempCareLocation: c.tempCareLocation, gridWorkerName: c.gridWorkerName, escalatedAt: c.escalatedAt,
      pickupPersonName: c.pickupPersonName, pickupPersonRelation: c.pickupPersonRelation,
      pickupPersonPhone: c.pickupPersonPhone, pickupPersonIdCard: c.pickupPersonIdCard,
      parentConfirmedPickup: c.parentConfirmedPickup,
      soloRestrictedAfter: c.soloRestrictedAfter, riskAdded: c.riskAdded, resolution: c.resolution,
      student: { id: c.student.id, name: c.student.name, grade: c.student.grade },
      reservation: {
        id: c.reservation.id, arrivalSlot: c.reservation.arrivalSlot, plannedLeave: c.reservation.plannedLeave,
        leaveMode: c.reservation.leaveMode, status: c.reservation.status,
        emergencyContact: c.reservation.emergencyContact, emergencyPhone: c.reservation.emergencyPhone,
      },
      lockedSnapshot: c.lockedSnapshot,
      actions: c.actions.map(a => ({
        id: a.id, type: a.type, detail: a.detail, actorName: a.actorName,
        actorRole: a.actorRole, time: a.time,
      })),
      suggestion: this.suggest(c),
    };
  }

  /** 开单：到点未接，锁定现场快照（迟到/当日巡查班次/排班/预约），并联动协同事件 */
  @Roles(...STAFF_ROLES)
  @Post('pickup-cases')
  async open(@Req() req: any, @Body() body: { reservationId: number; note?: string }) {
    const r = await this.db.reservations.findOne({
      where: { id: Number(body.reservationId) }, relations: ['student'],
    });
    if (!r) throw new NotFoundException('预约不存在');

    // 已有进行中处置单 → 幂等返回（不重复生成事件/风险）
    const existing = await this.db.pickupCases.findOne({
      where: { reservationId: r.id, status: In(['waiting', 'escorted', 'temp_care', 'escalated']) },
    });
    if (existing) return this.detail(existing.id, req);

    // 开单时机：仅已入场学生、且已到计划离场时间（家长仍未接）
    if (r.status !== 'checked_in') {
      throw new BadRequestException('学生尚未入场，不能开启晚间无人接处置');
    }
    const now = DbService.nowShanghai();
    const todayStr = DbService.todayStr(now);
    const [ph, pm] = r.plannedLeave.split(':').map(Number);
    const nowHM = now.getHours() * 60 + now.getMinutes();
    if (r.date > todayStr) {
      throw new BadRequestException(`预约日期为 ${r.date}，尚未到计划离场时间 ${r.plannedLeave}，不能提前开启无人接处置`);
    }
    if (r.date === todayStr && nowHM < ph * 60 + pm) {
      const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      throw new BadRequestException(
        `尚未到计划离场时间 ${r.plannedLeave}（当前 ${cur}），家长仍在正常接领窗口内，不能提前开启无人接处置`,
      );
    }

    const snapshot = await this.buildSnapshot(r.id, r.studentId);

    const c = await this.db.ds.transaction(async manager => {
      const saved = await manager.save(this.db.pickupCases.create({
        reservationId: r.id, studentId: r.studentId, date: r.date,
        status: 'waiting', openedAt: DbService.nowShanghai(),
        authorizedLeaveMode: r.leaveMode, gradeSnapshot: r.student.grade,
        dutyStaffName: req.user.role === 'security' ? '' : req.user.name,
        lockedSnapshot: snapshot,
      }));
      await manager.save(this.db.pickupActions.create({
        pickupCaseId: saved.id, type: 'open', actorName: req.user.name, actorRole: req.user.role,
        time: DbService.nowShanghai(),
        detail: body.note || `已到计划离场时间 ${r.plannedLeave}，家长未到，开单处置`,
      }));
      return saved;
    });

    // 联动协同事件（志愿者/社区/家长/安保围绕同一事件）
    let incidentId = snapshot.incidentId;
    if (!incidentId) {
      const inc = await this.db.incidents.save(this.db.incidents.create({
        date: r.date, type: 'night_unpicked',
        title: `晚间无人接：${r.student.name} 已超计划离场时间`,
        description: `计划 ${r.plannedLeave} 离场（${r.leaveMode === 'solo' ? '独自离场' : '家长接'}），家长未到。紧急联系：${r.emergencyContact} ${r.emergencyPhone}`,
        openedByName: req.user.name, status: 'open', escalated: true,
        reservationId: r.id, studentId: r.studentId,
      }));
      await this.db.incidentMessages.save(this.db.incidentMessages.create({
        incidentId: inc.id, authorName: req.user.name, authorRole: req.user.role,
        content: '晚间无人接处置单已开单，现场快照已锁定。',
      }));
      incidentId = inc.id;
    }
    const saved = await this.db.pickupCases.findOneBy({ id: c.id });
    saved!.lockedSnapshot = { ...snapshot, incidentId };
    await this.db.pickupCases.save(saved!);
    return this.detail(c.id, req);
  }

  /** 联系家长留痕：未接通/已联系 */
  @Roles(...STAFF_ROLES)
  @Post('pickup-cases/:id/contact')
  async contact(@Param('id') id: number, @Req() req: any,
                @Body() body: { reached: boolean; channel?: string; note?: string }) {
    const c = await this.getCaseOr404(id);
    this.assertOpen(c);
    c.contactAttempts += 1;
    if (body.reached) c.contactReached += 1;
    await this.db.pickupCases.save(c);
    await this.addAction(c.id, 'contact_attempt', req,
      `${body.reached ? '已联系上家长' : '未接通'}（${body.channel || '电话'}）${body.note ? '：' + body.note : ''}`);
    return this.detail(c.id, req);
  }

  /** 家长回复（家长本人或工作人员代记） */
  @Post('pickup-cases/:id/parent-reply')
  async parentReply(@Param('id') id: number, @Req() req: any, @Body() body: { content: string }) {
    const c = await this.getCaseOr404(id);
    await this.assertAccess(c, req.user);
    if (!body.content?.trim()) throw new BadRequestException('回复内容不能为空');
    this.assertOpen(c);
    c.lastParentReply = body.content.trim();
    c.lastParentReplyAt = DbService.nowShanghai();
    await this.db.pickupCases.save(c);
    await this.addAction(c.id, 'parent_reply', req, body.content.trim());
    return this.detail(c.id, req);
  }

  /** 值班人员处置决策：继续留守 / 陪同到门口 / 转入临时看护 */
  @Roles(...OFFICER_ROLES)
  @Post('pickup-cases/:id/decide')
  async decide(@Param('id') id: number, @Req() req: any, @Body() body: {
    decision: 'wait' | 'escort' | 'temp_care';
    dutyStaffName?: string; escortName?: string; tempCareLocation?: string; note?: string;
  }) {
    const c = await this.getCaseOr404(id);
    this.assertOpen(c);
    if (!['wait', 'escort', 'temp_care'].includes(body.decision)) throw new BadRequestException('处置方式不合法');

    c.dutyStaffName = body.dutyStaffName || c.dutyStaffName || req.user.name;
    let type: PickupActionType = 'wait';
    let detail = '';
    if (body.decision === 'wait') {
      c.status = 'waiting';
      type = 'wait';
      detail = `值班人员 ${c.dutyStaffName} 决定继续留守等待${body.note ? '：' + body.note : ''}`;
    } else if (body.decision === 'escort') {
      // 低龄且授权为家长接的，不允许仅陪同到门口放行
      if (DbService.isJunior(c.gradeSnapshot) && c.authorizedLeaveMode === 'pickup' && !c.lastParentReply) {
        throw new BadRequestException('低年级学生且尚无家长回复，不能陪同放行，请转临时看护或先取得家长确认');
      }
      c.status = 'escorted';
      c.escortName = body.escortName || req.user.name;
      type = 'escort';
      detail = `由志愿者 ${c.escortName} 陪同到门口交接${body.note ? '：' + body.note : ''}`;
    } else {
      c.status = 'temp_care';
      c.tempCareLocation = body.tempCareLocation || '社区临时看护室';
      type = 'temp_care';
      detail = `转入临时看护（${c.tempCareLocation}），值守人 ${c.dutyStaffName}${body.note ? '：' + body.note : ''}`;
    }
    await this.db.pickupCases.save(c);
    await this.addAction(c.id, type, req, detail);
    return this.detail(c.id, req);
  }

  /** 家长持续无响应 → 值班人员选择留守或升级网格员 */
  @Roles(...OFFICER_ROLES, 'security')
  @Post('pickup-cases/:id/escalate')
  async escalate(@Param('id') id: number, @Req() req: any,
                 @Body() body: { gridWorkerName: string; note?: string; keepWaiting?: boolean }) {
    const c = await this.getCaseOr404(id);
    this.assertOpen(c);
    if (!body.gridWorkerName?.trim()) throw new BadRequestException('请填写接报网格员姓名');
    c.status = 'escalated';
    c.gridWorkerName = body.gridWorkerName.trim();
    c.escalatedAt = DbService.nowShanghai();
    await this.db.pickupCases.save(c);
    await this.addAction(c.id, 'escalate', req,
      `家长 ${c.contactAttempts} 次联系未响应，升级网格员 ${c.gridWorkerName}${body.note ? '：' + body.note : ''}`);
    // 联动协同事件升级
    const incId = c.lockedSnapshot?.incidentId;
    if (incId) {
      await this.db.incidentMessages.save(this.db.incidentMessages.create({
        incidentId: incId, authorName: req.user.name, authorRole: req.user.role,
        content: `已升级网格员 ${c.gridWorkerName}，学生当前${c.tempCareLocation ? '在' + c.tempCareLocation : '留守自习室'}。`,
      }));
    }
    return this.detail(c.id, req);
  }

  /** 接走结案：登记临时接送人并锁定快照，办理离场，风险计入家庭档案 */
  @Roles(...OFFICER_ROLES, 'security')
  @Post('pickup-cases/:id/resolve')
  async resolve(@Param('id') id: number, @Req() req: any, @Body() body: {
    pickupPersonName: string; pickupPersonRelation: string; pickupPersonPhone?: string;
    pickupPersonIdCard?: string; parentConfirmed: boolean;
    restrictSolo?: boolean; resolution?: string;
  }) {
    const c = await this.getCaseOr404(id);
    if (c.status === 'resolved') throw new BadRequestException('处置单已结案，不能重复结案');
    if (!body.pickupPersonName?.trim()) throw new BadRequestException('请登记实际接走人');
    if (!body.pickupPersonRelation?.trim()) throw new BadRequestException('请登记接走人与学生关系');

    const now = DbService.nowShanghai();
    const wasEscalated = c.status === 'escalated';
    c.status = 'resolved';
    c.resolvedAt = now;
    c.pickupPersonName = body.pickupPersonName.trim();
    c.pickupPersonRelation = body.pickupPersonRelation.trim();
    c.pickupPersonPhone = body.pickupPersonPhone || '';
    c.pickupPersonIdCard = body.pickupPersonIdCard || '';
    c.parentConfirmedPickup = !!body.parentConfirmed;
    c.resolution = body.resolution || `${c.pickupPersonName}（${c.pickupPersonRelation}）凭证件接走`;

    // 无人接风险规则：家长始终未联系上、低龄学生或已升级网格员 → 限制该家庭（全部孩子）后续独自离场
    const noReply = c.contactReached === 0;
    const restrict = body.restrictSolo !== undefined
      ? !!body.restrictSolo
      : (DbService.isJunior(c.gradeSnapshot) || noReply || wasEscalated);
    const s = await this.db.applyPickupRisk(c.studentId, { restrictFamily: restrict });
    c.riskAdded = 1;
    c.soloRestrictedAfter = s.soloPickupRestricted;

    // 锁定最终现场快照（迟到/临时接送人/当日巡查班次不可再变）
    const freshSnapshot = await this.buildSnapshot(c.reservationId, c.studentId);
    c.lockedSnapshot = {
      ...c.lockedSnapshot, ...freshSnapshot,
      lockedAt: now,
      pickupPerson: {
        name: c.pickupPersonName, relation: c.pickupPersonRelation,
        phone: c.pickupPersonPhone, idCard: c.pickupPersonIdCard,
        parentConfirmed: c.parentConfirmedPickup,
      },
    };
    await this.db.pickupCases.save(c);
    await this.addAction(c.id, 'resolve', req,
      `${c.resolution}；该家庭离场风险累计 ${s.pickupRiskCount} 次${s.soloPickupRestricted ? '，独自离场权限已限制' : ''}`);

    // 办理离场
    const r = await this.db.reservations.findOne({ where: { id: c.reservationId }, relations: ['student'] });
    if (r && r.status === 'checked_in') {
      r.status = 'checked_out';
      r.checkedOutAt = now;
      r.actualLeaveMode = 'pickup';
      r.checkOutOperator = req.user.name;
      await this.db.reservations.save(r);
    }
    // 关闭联动事件
    const incId = c.lockedSnapshot?.incidentId;
    if (incId) {
      const inc = await this.db.incidents.findOneBy({ id: incId });
      if (inc && inc.status !== 'resolved') {
        inc.status = 'resolved';
        inc.resolution = c.resolution;
        inc.resolvedAt = now;
        await this.db.incidents.save(inc);
      }
    }
    return this.detail(c.id, req);
  }

  /** 社区解除家庭独自离场限制（覆盖该家长全部孩子） */
  @Roles('admin', 'staff')
  @Post('students/:id/clear-pickup-restriction')
  async clearRestriction(@Param('id') id: number) {
    const s = await this.db.students.findOneBy({ id: Number(id) });
    if (!s) throw new NotFoundException('学生不存在');
    await this.db.clearFamilyRestriction(s.parentId);
    const kids = await this.db.students.find({ where: { parentId: s.parentId } });
    return { id: s.id, familySoloRestricted: false, students: kids.map(k => ({ id: k.id, soloPickupRestricted: false })) };
  }

  // ---------------- 内部方法 ----------------
  private async getCaseOr404(id: number) {
    const c = await this.db.pickupCases.findOne({ where: { id: Number(id) }, relations: ['reservation'] });
    if (!c) throw new NotFoundException('处置单不存在');
    return c;
  }
  private assertOpen(c: PickupCase) {
    if (c.status === 'resolved') throw new BadRequestException('处置单已结案，不能再操作');
  }
  private async assertAccess(c: PickupCase, user: any) {
    if (user.role === 'parent') {
      const r = await this.db.reservations.findOneBy({ id: c.reservationId });
      if (!r || r.parentId !== user.sub) throw new ForbiddenException('无权访问该处置单');
    }
  }
  private async addAction(caseId: number, type: PickupActionType, req: any, detail: string) {
    await this.db.pickupActions.save(this.db.pickupActions.create({
      pickupCaseId: caseId, type, detail,
      actorName: req.user.name, actorRole: req.user.role, time: DbService.nowShanghai(),
    }));
  }

  /** 现场快照（委托 DbService，供定时任务复用） */
  private buildSnapshot(reservationId: number, studentId: number, incidentId?: number | null) {
    return this.db.buildPickupSnapshot(reservationId, studentId, incidentId);
  }

  /** 处置建议：依据授权离场方式、年龄、家长联系记录给出 */
  private suggest(c: PickupCase): string {
    const junior = DbService.isJunior(c.gradeSnapshot);
    if (c.contactReached === 0 && c.contactAttempts >= 2) {
      return junior
        ? '家长多次未接通且学生为低年级：不得放行，立即转入临时看护并升级网格员。'
        : '家长多次未接通：先安排临时看护，同时升级网格员协查。';
    }
    if (c.lastParentReply) {
      if (/(\d+)\s*分钟|马上|到了|门口/.test(c.lastParentReply)) {
        return '家长已回复且即将到达：可安排值班人员继续留守等待。';
      }
      return '家长已有回复：按回复内容选择继续等待或陪同到门口交接。';
    }
    if (junior && c.authorizedLeaveMode === 'pickup') {
      return '低年级且授权方式为家长接：在家长确认前不得独自放行，优先临时看护。';
    }
    if (!junior && c.authorizedLeaveMode === 'solo') {
      return '高年级且预约已授权独自离场：取得家长口头/消息确认后可由志愿者陪同到门口。';
    }
    return '请继续联系家长；等待期间保证至少一名值守人员在场。';
  }
}
