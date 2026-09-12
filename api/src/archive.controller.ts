import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { DbService } from './db.service';
import { AuthGuard, Roles } from './auth.guard';

const ZONE_LABEL: Record<string, string> = {
  junior: '低龄陪护区', quiet: '安静区', window: '临窗区', general: '普通区',
};

@Controller()
@UseGuards(AuthGuard)
export class ArchiveController {
  constructor(private db: DbService) {}

  /** 当日档案：签到 / 座位 / 异常 / 家长确认 / 巡查记录进入同一日档案 */
  @Roles('admin', 'staff', 'volunteer', 'security')
  @Get('daily-archive')
  async dailyArchive(@Query('date') date?: string) {
    const day = date || DbService.todayStr();
    const reservations = await this.db.reservations.find({
      where: { date: day }, relations: ['student', 'seat'], order: { checkedInAt: 'ASC', id: 'ASC' },
    });
    const incidents = await this.db.incidents.find({ where: { date: day }, order: { createdAt: 'ASC' } });
    const start = new Date(`${day}T00:00:00+08:00`);
    const end = new Date(`${day}T23:59:59+08:00`);
    const patrolRows = await this.db.patrols.createQueryBuilder('p')
      .where('p.time BETWEEN :s AND :e', { s: start, e: end })
      .orderBy('p.time', 'ASC').getMany();

    const checkedIn = reservations.filter(r => ['checked_in', 'checked_out'].includes(r.status));
    return {
      date: day,
      summary: {
        total: reservations.length,
        confirmed: reservations.filter(r => ['confirmed', 'checked_in', 'checked_out', 'no_show'].includes(r.status)).length,
        checkedIn: checkedIn.length,
        checkedOut: reservations.filter(r => r.status === 'checked_out').length,
        noShow: reservations.filter(r => r.status === 'no_show').length,
        pending: reservations.filter(r => r.status === 'pending').length,
        parentConfirmed: reservations.filter(r => r.parentConfirmed).length,
        incidentsOpen: incidents.filter(i => i.status !== 'resolved').length,
        incidentsResolved: incidents.filter(i => i.status === 'resolved').length,
        patrols: patrolRows.length,
      },
      records: reservations.map(r => ({
        reservationId: r.id,
        studentName: r.student?.name, grade: r.student?.grade,
        arrivalSlot: r.arrivalSlot, status: r.status,
        seat: r.seat ? `${r.seat.code}（${ZONE_LABEL[r.seat.zone] || r.seat.zone}${r.seat.monitored ? '·监控覆盖' : ''}）` : null,
        checkedInAt: r.checkedInAt, checkedOutAt: r.checkedOutAt,
        checkInOperator: r.checkInOperator, checkOutOperator: r.checkOutOperator,
        actualLeaveMode: r.actualLeaveMode, leaveMode: r.leaveMode,
        parentConfirmed: r.parentConfirmed, parentConfirmedAt: r.parentConfirmedAt,
        allergies: r.allergies, careNote: r.careNote,
      })),
      incidents: incidents.map(i => ({
        id: i.id, type: i.type, title: i.title, status: i.status,
        escalated: i.escalated, openedByName: i.openedByName, resolution: i.resolution,
      })),
      patrols: patrolRows.map(p => ({
        id: p.id, time: p.time, area: p.area, finding: p.finding, normal: p.normal, recorderName: p.recorderName,
      })),
    };
  }

  /** 看护时间线：按学生/家长/志愿者/安保，回溯入场→座位→巡查→异常→离场证据 */
  @Get('timeline')
  async timeline(@Query('date') date: string | undefined, @Query('studentId') studentId?: string, @Req() req?: any) {
    const day = date || DbService.todayStr();
    const where: any = { date: day };
    if (studentId) where.studentId = Number(studentId);
    let reservations = await this.db.reservations.find({
      where, relations: ['student', 'seat', 'room'], order: { id: 'ASC' },
    });
    if (req?.user?.role === 'parent') reservations = reservations.filter(r => r.parentId === req.user.sub);
    if (!reservations.length) return { date: day, students: [] };

    const ids = reservations.map(r => r.id);
    const [events, incidents] = await Promise.all([
      this.db.studyEvents.createQueryBuilder('e')
        .where('e.reservation_id IN (:...ids)', { ids }).orderBy('e.occurredAt', 'ASC').getMany(),
      this.db.incidents.createQueryBuilder('i')
        .leftJoinAndSelect('i.student', 'student')
        .where('i.reservation_id IN (:...ids) OR i.date = :day', { ids, day })
        .orderBy('i.createdAt', 'ASC').getMany(),
    ]);

    const start = new Date(`${day}T00:00:00+08:00`);
    const end = new Date(`${day}T23:59:59+08:00`);
    const dayPatrols = await this.db.patrols.createQueryBuilder('p')
      .where('p.time BETWEEN :s AND :e', { s: start, e: end }).orderBy('p.time', 'ASC').getMany();

    const EVENT_LABEL: Record<string, string> = {
      late: '迟到', leave_seat: '离座', charger: '借用充电器', temp_out: '临时外出',
      unwell: '身体不适', parent_message: '家长留言', returned: '外出返回',
    };

    return {
      date: day,
      students: reservations.map(r => {
        const rEvents = events.filter(e => e.reservationId === r.id);
        const rIncidents = incidents.filter(i => i.reservationId === r.id || i.studentId === r.studentId);
        const items: any[] = [];
        // 入场证据
        if (r.checkedInAt) {
          items.push({ time: r.checkedInAt, actor: r.checkInOperator, actorRole: 'staff', kind: 'checkin',
            text: `入场核验通过：家长授权${r.authVerified ? '✓' : '✗'} 随身物品${r.belongingsChecked ? '✓' : '✗'} 离场方式${r.leaveModeVerified ? '✓' : '✗'}`,
            evidence: true });
          items.push({ time: r.checkedInAt, actor: '系统', actorRole: 'staff', kind: 'seat',
            text: `分配座位 ${r.seat?.code}（${ZONE_LABEL[r.seat?.zone] || ''}${r.seat?.monitored ? '·监控覆盖' : ''}）${r.room ? ' @' + r.room.name : ''}`,
            evidence: true });
        }
        // 该生座位所在房间的巡查作为看护证据
        for (const p of dayPatrols) {
          if (!r.roomId || p.roomId !== r.roomId) continue;
          items.push({ time: p.time, actor: p.recorderName, actorRole: 'security', kind: 'patrol',
            text: `安全巡查：${p.area}${p.finding ? '—' + p.finding : '（无异常）'}`, evidence: true });
        }
        for (const e of rEvents) {
          items.push({ time: e.occurredAt, actor: e.recorderName, actorRole: 'volunteer', kind: 'event',
            text: `${EVENT_LABEL[e.type] || e.type}${e.detail ? '：' + e.detail : ''}`,
            abnormal: ['late', 'temp_out', 'leave_seat', 'unwell'].includes(e.type) });
        }
        for (const inc of rIncidents) {
          items.push({ time: inc.createdAt, actor: inc.openedByName, actorRole: 'staff', kind: 'incident',
            text: `协同事件【${inc.title}】状态：${inc.status}${inc.escalated ? '（已升级）' : ''}`,
            incidentId: inc.id });
        }
        if (r.checkedOutAt) {
          items.push({ time: r.checkedOutAt, actor: r.checkOutOperator, actorRole: 'staff', kind: 'checkout',
            text: `离场登记：${r.actualLeaveMode === 'solo' ? '独自离场' : '家长接'}`, evidence: true });
        }
        if (r.parentConfirmedAt) {
          items.push({ time: r.parentConfirmedAt, actor: '家长', actorRole: 'parent', kind: 'confirm',
            text: '家长已电子确认安全接离/到家', evidence: true });
        }
        items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        return {
          reservationId: r.id,
          student: r.student ? { id: r.student.id, name: r.student.name, grade: r.student.grade, watchlisted: r.student.watchlisted } : null,
          parentName: '家长', status: r.status,
          timeline: items,
        };
      }),
    };
  }

  /** 周统计：预约使用率 / 异常事件 / 家长响应，供周末开放、低龄陪护、晚间独自离场决策 */
  @Roles('admin', 'staff')
  @Get('weekly-report')
  async weekly(@Query('endDate') endDate?: string) {
    const end = endDate || DbService.todayStr();
    const [ey, em, ed] = end.split('-').map(Number);
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      days.push(new Date(Date.UTC(ey, em - 1, ed - i)).toISOString().slice(0, 10));
    }
    const totalSeats = await this.db.seats.count();
    const [reservations, incidents, patrols] = await Promise.all([
      this.db.reservations.createQueryBuilder('r')
        .leftJoinAndSelect('r.student', 'student')
        .where('r.date IN (:...days)', { days }).getMany(),
      this.db.incidents.createQueryBuilder('i').where('i.date IN (:...days)', { days }).getMany(),
      this.db.patrols.createQueryBuilder('p')
        .where('p.time BETWEEN :s AND :e', { s: new Date(`${days[0]}T00:00:00+08:00`), e: new Date(`${days[6]}T23:59:59+08:00`) })
        .getMany(),
    ]);
    const perDay = days.map(day => {
      const rs = reservations.filter(r => r.date === day);
      const ins = incidents.filter(i => i.date === day);
      const checked = rs.filter(r => ['checked_in', 'checked_out'].includes(r.status)).length;
      return {
        date: day,
        reservations: rs.length,
        utilization: totalSeats ? Math.round((checked / totalSeats) * 100) : 0,
        checkedIn: checked,
        noShow: rs.filter(r => r.status === 'no_show').length,
        juniorSoloEvening: rs.filter(r => r.leaveMode === 'solo' && r.student && r.student.grade <= 3
          && Number(r.plannedLeave.split(':')[0]) >= 19).length,
        incidents: ins.length,
        incidentsOpen: ins.filter(i => i.status !== 'resolved').length,
        parentConfirmed: rs.filter(r => r.parentConfirmed).length,
        parentResponseRate: checked ? Math.round((rs.filter(r => r.parentConfirmed).length / checked) * 100) : 0,
      };
    });
    const totalRes = reservations.length;
    const totalChecked = perDay.reduce((a, b) => a + b.checkedIn, 0);
    const incidentByType: Record<string, number> = {};
    for (const i of incidents) incidentByType[i.type] = (incidentByType[i.type] || 0) + 1;

    // 自动运营建议
    const avgUtil = perDay.reduce((a, b) => a + b.utilization, 0) / 7;
    const suggestions: string[] = [];
    if (avgUtil >= 70) suggestions.push('周均使用率已达 70% 以上，建议开放周末时段并增加志愿者排班。');
    if ((incidentByType['conflict'] || 0) >= 2 || (incidentByType['night_unpicked'] || 0) >= 1)
      suggestions.push('本周出现冲突/晚间无人接事件，建议增加低龄陪护志愿者。');
    if (perDay.some(d => d.juniorSoloEvening > 0))
      suggestions.push('存在低年级晚间独自离场预约，建议缩短低年级独自离场权限截止时间。');
    if ((incidentByType['no_show'] || 0) >= 3)
      suggestions.push('未到事件较多，建议加强家长到场前提醒与确认。');
    if (!suggestions.length) suggestions.push('本周运行平稳，维持现有开放时段与排班。');

    return {
      range: [days[0], days[6]], totalSeats,
      totals: {
        reservations: totalRes, checkedIn: totalChecked,
        avgUtilization: Math.round(avgUtil),
        incidents: incidents.length, incidentsResolved: incidents.filter(i => i.status === 'resolved').length,
        parentResponseRate: totalChecked
          ? Math.round((reservations.filter(r => r.parentConfirmed).length / totalChecked) * 100) : 0,
        patrols: patrols.length,
      },
      incidentByType, perDay, suggestions,
    };
  }

  /** 重点关注名单 */
  @Roles('admin', 'staff', 'volunteer', 'security')
  @Get('watchlist')
  async watchlist() {
    const students = await this.db.students.find({
      where: { watchlisted: true }, order: { abnormalScore: 'DESC' },
    });
    return students.map(s => ({
      id: s.id, name: s.name, grade: s.grade, abnormalScore: s.abnormalScore,
      careNeeds: s.careNeeds,
    }));
  }

  /** 社区负责人手动加入/移出重点关注名单 */
  @Roles('admin', 'staff')
  @Post('students/:id/watchlist')
  async toggleWatchlist(@Param('id') id: number, @Req() req: any, @Body() body: { watchlisted: boolean }) {
    const s = await this.db.students.findOneBy({ id: Number(id) });
    if (!s) throw new NotFoundException('学生不存在');
    s.watchlisted = !!body.watchlisted;
    if (!s.watchlisted) s.abnormalScore = 0;
    await this.db.students.save(s);
    return { id: s.id, watchlisted: s.watchlisted, abnormalScore: s.abnormalScore };
  }
}
