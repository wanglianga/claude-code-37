import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  User, Student, Room, Seat, OpenSchedule, VolunteerShift, Reservation,
  StudyEvent, Incident, IncidentMessage, Patrol,
} from './entities';

@Injectable()
export class DbService {
  constructor(public ds: DataSource) {}

  // 中国时区当日字符串 YYYY-MM-DD
  static todayStr(d = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  }
  static nowShanghai(): Date {
    // 以 Asia/Shanghai 墙上时间构造一个真实 Date（用于落库与比较）
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)!.value;
    return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}:${get('second')}+08:00`);
  }

  get users() { return this.ds.getRepository(User); }
  get students() { return this.ds.getRepository(Student); }
  get rooms() { return this.ds.getRepository(Room); }
  get seats() { return this.ds.getRepository(Seat); }
  get schedules() { return this.ds.getRepository(OpenSchedule); }
  get shifts() { return this.ds.getRepository(VolunteerShift); }
  get reservations() { return this.ds.getRepository(Reservation); }
  get studyEvents() { return this.ds.getRepository(StudyEvent); }
  get incidents() { return this.ds.getRepository(Incident); }
  get incidentMessages() { return this.ds.getRepository(IncidentMessage); }
  get patrols() { return this.ds.getRepository(Patrol); }

  /** 累计异常分，达到阈值进入重点关注名单 */
  async addAbnormal(studentId: number, points: number) {
    const s = await this.students.findOneBy({ id: studentId });
    if (!s) return;
    s.abnormalScore += points;
    if (s.abnormalScore >= 8) s.watchlisted = true;
    await this.students.save(s);
  }

  /** 低龄阈值：1-3 年级 */
  static isJunior(grade: number) { return grade <= 3; }

  /**
   * 座位分配：低龄→低龄陪护区；申请安静→安静区；其余优先临窗区；
   * 一律优先监控覆盖座位，监控位满后才分配非监控位。
   */
  async allocateSeat(student: Student, date: string, careNote = '', explicitSeatId?: number) {
    const occupied = await this.reservations.find({
      where: [{ status: 'checked_in', date }],
    });
    const occupiedSeatIds = new Set(occupied.map(r => r.seatId).filter(Boolean));
    const seats = (await this.seats.find({ relations: ['room'] }))
      .filter(s => s.room.active && !occupiedSeatIds.has(s.id));

    const wantQuiet = /安静/.test(careNote + student.careNeeds);
    const zonePref = DbService.isJunior(student.grade)
      ? ['junior', 'quiet', 'window', 'general']
      : wantQuiet ? ['quiet', 'window', 'general', 'junior']
                  : ['window', 'general', 'quiet', 'junior'];

    const rank = (s: Seat) => (s.monitored ? 0 : 10) + zonePref.indexOf(s.zone);
    if (explicitSeatId) {
      const forced = seats.find(s => s.id === explicitSeatId);
      if (!forced) throw new Error('指定座位不存在或已被占用');
      return forced;
    }
    seats.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
    if (!seats.length) throw new Error('今日座位已全部占满');
    return seats[0];
  }
}
