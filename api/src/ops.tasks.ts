import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In } from 'typeorm';
import { DbService } from './db.service';

function toMin(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

@Injectable()
export class OpsTasks {
  constructor(private db: DbService) {}

  /**
   * 每 10 分钟扫描：
   * - 超过到场时段起始 30 分钟仍未入场 → 未到（no_show），自动发起协同事件并计分
   * - 已入场但超过计划离场时间 30 分钟仍未离场登记 → 自动发起晚归/晚间无人接事件
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    const day = DbService.todayStr();
    const now = DbService.nowShanghai();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // 未到
    const confirmed = await this.db.reservations.find({
      where: { date: day, status: In(['confirmed']) }, relations: ['student'],
    });
    for (const r of confirmed) {
      const slotStart = toMin(r.arrivalSlot.split('-')[0]);
      if (nowMin >= slotStart + 30) {
        r.status = 'no_show';
        await this.db.reservations.save(r);
        const exists = await this.db.incidents.findOne({
          where: { date: day, reservationId: r.id, type: 'no_show' },
        });
        if (!exists) {
          const inc = await this.db.incidents.save(this.db.incidents.create({
            date: day, type: 'no_show',
            title: `学生未到：${r.student?.name}（${r.arrivalSlot}）`,
            description: '系统扫描：超过到场时段 30 分钟未入场，请志愿者联系家长核实。',
            openedByName: '系统', status: 'open', reservationId: r.id, studentId: r.studentId,
          }));
          await this.db.incidentMessages.save(this.db.incidentMessages.create({
            incidentId: inc.id, authorName: '系统', authorRole: 'staff',
            content: '自动发起：请志愿者尽快电话联系家长，确认是否改期或安全原因。',
          }));
          await this.db.addAbnormal(r.studentId, 1);
        }
      }
    }

    // 晚归 / 晚间无人接
    const inside = await this.db.reservations.find({
      where: { date: day, status: 'checked_in' }, relations: ['student'],
    });
    for (const r of inside) {
      if (nowMin >= toMin(r.plannedLeave) + 30 && r.leaveMode === 'pickup') {
        const exists = await this.db.incidents.findOne({
          where: { date: day, reservationId: r.id, type: 'night_unpicked' },
        });
        if (!exists) {
          const inc = await this.db.incidents.save(this.db.incidents.create({
            date: day, type: 'night_unpicked',
            title: `晚间无人接：${r.student?.name} 已超计划离场时间`,
            description: `计划 ${r.plannedLeave} 由家长接，目前仍在场。请工作人员联系紧急联系人 ${r.emergencyContact || ''} ${r.emergencyPhone || ''}，必要时安保介入。`,
            openedByName: '系统', status: 'open', escalated: true,
            reservationId: r.id, studentId: r.studentId,
          }));
          await this.db.incidentMessages.save(this.db.incidentMessages.create({
            incidentId: inc.id, authorName: '系统', authorRole: 'security',
            content: '已自动升级：请安保与社区工作人员联动看护，不得让学生独自离场。',
          }));
        }
      }
    }
  }
}
