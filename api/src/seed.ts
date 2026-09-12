import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  User, Student, Room, Seat, OpenSchedule, VolunteerShift, Reservation,
  StudyEvent, Incident, IncidentMessage, Patrol, SeatZone, PickupCase, PickupAction,
} from './entities';

function weekdayOf(dateStr: string): number {
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
}
function shToday(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}
function shTime(day: string, hhmm: string) {
  return new Date(`${day}T${hhmm}:00+08:00`);
}
function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function shTimeOffset(day: string, hhmm: string, deltaMin: number) {
  return new Date(shTime(day, hhmm).getTime() + deltaMin * 60000);
}

export async function runSeed(ds: DataSource) {
  const users = ds.getRepository(User);
  if (await users.count()) return false; // 已播种，幂等跳过

  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const mk = async (username: string, password: string, name: string, role: any, phone: string) =>
    users.save(users.create({ username, passwordHash: hash(password), name, role, phone }));

  const admin = await mk('admin', 'admin123', '王主任', 'admin', '13800000001');
  const staff = await mk('staff', 'staff123', '李社工', 'staff', '13800000002');
  const v1 = await mk('volunteer', 'vol123', '张志愿', 'volunteer', '13800000003');
  const v2 = await mk('volunteer2', 'vol123', '陈晓志愿者', 'volunteer', '13800000004');
  const sec = await mk('security', 'sec123', '赵安保', 'security', '13800000005');
  const p1 = await mk('parent1', 'parent123', '周敏', 'parent', '13900000001');
  const p2 = await mk('parent2', 'parent123', '吴磊', 'parent', '13900000002');
  const p3 = await mk('parent3', 'parent123', '郑华', 'parent', '13900000003');

  // ---------- 学生 ----------
  const students = ds.getRepository(Student);
  const s1 = await students.save(students.create({
    name: '周小雨', grade: 2, school: '阳光小学', parentId: p1.id,
    allergies: '花生过敏', careNeeds: '低龄，需要提醒喝水',
    emergencyContact: '周敏（妈妈）', emergencyPhone: '13900000001',
  }));
  const s2 = await students.save(students.create({
    name: '周小川', grade: 7, school: '滨河中学', parentId: p1.id,
    allergies: '', careNeeds: '希望安排安静区',
    emergencyContact: '周敏（妈妈）', emergencyPhone: '13900000001',
  }));
  const s3 = await students.save(students.create({
    name: '吴小天', grade: 5, school: '阳光小学', parentId: p2.id,
    allergies: '尘螨过敏', careNeeds: '',
    emergencyContact: '吴磊（爸爸）', emergencyPhone: '13900000002',
  }));
  const s4 = await students.save(students.create({
    name: '郑乐乐', grade: 3, school: '阳光小学', parentId: p3.id,
    allergies: '青霉素过敏', careNeeds: '近期多次冲突晚归，需重点看护',
    emergencyContact: '郑华（妈妈）', emergencyPhone: '13900000003',
    watchlisted: true, abnormalScore: 9,
  }));

  // ---------- 场地与座位 ----------
  const rooms = ds.getRepository(Room);
  const room = await rooms.save(rooms.create({ name: '阳光社区自习室', capacity: 24 }));
  const seats = ds.getRepository(Seat);
  const seatList: Seat[] = [];
  const zones: [string, SeatZone, number][] = [
    ['J', 'junior', 6], ['Q', 'quiet', 6], ['W', 'window', 6], ['G', 'general', 6],
  ];
  for (const [prefix, zone, n] of zones) {
    for (let i = 1; i <= n; i++) {
      const code = `${prefix}-${String(i).padStart(2, '0')}`;
      seatList.push(await seats.save(seats.create({
        code, zone, roomId: room.id, monitored: !(prefix === 'G' && i === 6),
      })));
    }
  }

  // ---------- 开放时间：工作日开放，周末暂不开放（供周报决策） ----------
  const schedules = ds.getRepository(OpenSchedule);
  for (const wd of [1, 2, 3, 4, 5]) {
    await schedules.save(schedules.create({
      weekday: wd, openTime: '16:30', closeTime: '21:00', soloLeaveDeadline: '19:30',
    }));
  }
  for (const wd of [0, 6]) {
    await schedules.save(schedules.create({
      weekday: wd, openTime: '09:00', closeTime: '17:30', soloLeaveDeadline: '16:00', active: false,
    }));
  }

  // ---------- 近 7 天排班 + 历史预约，用于周报 ----------
  const shifts = ds.getRepository(VolunteerShift);
  const reserv = ds.getRepository(Reservation);
  const events = ds.getRepository(StudyEvent);
  const incidents = ds.getRepository(Incident);
  const msgs = ds.getRepository(IncidentMessage);
  const patrols = ds.getRepository(Patrol);

  const today = shToday();
  const [ty, tm, td] = today.split('-').map(Number);
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(new Date(Date.UTC(ty, tm - 1, td - i)).toISOString().slice(0, 10));
  }

  let seatCursor = 0;
  const takeSeat = () => seatList[seatCursor++ % seatList.length];
  const histDefs: [Student, number, string, string, 'solo' | 'pickup'][] = [
    [s1, p1.id, '17:00-17:30', '20:00', 'pickup'],
    [s2, p1.id, '16:30-17:00', '19:00', 'solo'],
    [s3, p2.id, '18:00-18:30', '20:30', 'pickup'],
    [s4, p3.id, '18:30-19:00', '20:30', 'pickup'],
  ];

  for (const day of days) {
    const wd = weekdayOf(day);
    const isToday = day === today;
    // 历史天周末跳过（体现“暂未开放周末”）；当日为保证演示数据完整，无论周几都排班
    if (!isToday && (wd === 0 || wd === 6)) continue;

    await shifts.save([
      shifts.create({ date: day, startTime: '16:30', endTime: '18:30', volunteerId: v1.id, careCapacity: 10 }),
      shifts.create({ date: day, startTime: '18:30', endTime: '21:00', volunteerId: v2.id, careCapacity: 12 }),
    ]);

    if (isToday) continue; // 当日预约单独构造

    for (let idx = 0; idx < histDefs.length; idx++) {
      const [stu, pid, slot, leave, mode] = histDefs[idx];
      const isNoShow = stu.id === s3.id && day === days[2];
      const confirmed = !(stu.id === s3.id && day === days[days.length - 2]); // 制造一次家长未响应
      const seat = takeSeat();

      const entity = reserv.create({
        date: day, arrivalSlot: slot, plannedLeave: leave, leaveMode: mode,
        studentId: stu.id, parentId: pid,
        status: isNoShow ? 'no_show' : 'checked_out',
        reconfirmed: true,
        roomId: isNoShow ? undefined : room.id,
        seatId: isNoShow ? undefined : seat.id,
        checkedInAt: isNoShow ? undefined : shTime(day, slot.split('-')[0]),
        checkedOutAt: isNoShow ? undefined : shTime(day, leave),
        checkInOperator: isNoShow ? '' : '李社工',
        checkOutOperator: isNoShow ? '' : '赵安保',
        actualLeaveMode: isNoShow ? '' : mode,
        authVerified: !isNoShow, belongingsChecked: !isNoShow, leaveModeVerified: !isNoShow,
        parentConfirmed: !isNoShow && confirmed,
        parentConfirmedAt: !isNoShow && confirmed ? shTimeOffset(day, leave, 15) : undefined,
        emergencyContact: stu.emergencyContact, emergencyPhone: stu.emergencyPhone,
        allergies: stu.allergies,
      });
      const saved = await reserv.save(entity);

      await patrols.save([
        patrols.create({ time: shTime(day, '18:00'), area: '自习室全场', finding: '', normal: true, roomId: room.id, recorderName: '赵安保' }),
        patrols.create({ time: shTime(day, '20:00'), area: '出入口/监控死角', finding: '一切正常', normal: true, roomId: room.id, recorderName: '赵安保' }),
      ]);

      if (isNoShow) {
        const inc = await incidents.save(incidents.create({
          date: day, type: 'no_show', title: `学生未到：${stu.name}`,
          description: '超到场时段 30 分钟未入场。', status: 'resolved',
          resolution: '家长电话确认临时生病请假', resolvedAt: shTime(day, '19:00'),
          reservationId: saved.id, studentId: stu.id, openedByName: '系统',
        }));
        await msgs.save(msgs.create({
          incidentId: inc.id, authorName: '吴磊', authorRole: 'parent',
          content: '孩子突然发烧，今天请假，抱歉。',
        }));
        continue;
      }

      await events.save([
        events.create({ reservationId: saved.id, type: 'charger', detail: '借用 Type-C 充电器，已归还', occurredAt: shTime(day, '19:10'), recorderName: '张志愿' }),
        events.create({ reservationId: saved.id, type: 'parent_message', detail: '路上有点堵车，请稍等', occurredAt: shTimeOffset(day, leave, -20), recorderName: '家长' }),
      ]);

      if (stu.id === s4.id) {
        await events.save(events.create({
          reservationId: saved.id, type: 'late', detail: '晚到 20 分钟',
          occurredAt: shTime(day, '19:05'), recorderName: '张志愿',
        }));
        const inc = await incidents.save(incidents.create({
          date: day, type: 'conflict', title: `${stu.name}与同学发生口角`,
          description: '自习期间因借用文具与同学冲突，志愿者已分开座位。',
          status: 'resolved', escalated: true, resolution: '双方道歉，家长已知悉并接回',
          resolvedAt: shTime(day, '20:20'), reservationId: saved.id, studentId: stu.id,
          openedByName: '张志愿',
        }));
        await msgs.save([
          msgs.create({ incidentId: inc.id, authorName: '张志愿', authorRole: 'volunteer', content: '已将两名学生分开安排，情绪稳定。' }),
          msgs.create({ incidentId: inc.id, authorName: '赵安保', authorRole: 'security', content: '已到场协助，查看监控无肢体冲突。' }),
          msgs.create({ incidentId: inc.id, authorName: '郑华', authorRole: 'parent', content: '已知悉，我马上到。' }),
        ]);
        // 最近一个历史日：晚间无人接处置（低龄、家长未接通→临时看护→升级网格员→姑姑凭证件接走，家庭被限制独自离场）
        if (stu.id === s4.id && day === days[days.length - 2]) {
        const pcCases = ds.getRepository(PickupCase);
        const pcActs = ds.getRepository(PickupAction);
        const pc = await pcCases.save(pcCases.create({
          reservationId: saved.id, studentId: stu.id, date: day, status: 'resolved',
          openedAt: shTime(day, '20:35'), resolvedAt: shTime(day, '21:20'),
          authorizedLeaveMode: 'pickup', gradeSnapshot: stu.grade,
          contactAttempts: 3, contactReached: 0,
          lastParentReply: '', dutyStaffName: '李社工', escortName: '',
          tempCareLocation: '社区临时看护室', gridWorkerName: '孙网格员', escalatedAt: shTime(day, '20:55'),
          pickupPersonName: '郑琴', pickupPersonRelation: '姑姑', pickupPersonPhone: '13700001234',
          pickupPersonIdCard: '已核验登记', parentConfirmedPickup: true,
          riskAdded: 1, soloRestrictedAfter: true,
          resolution: '姑姑郑琴凭证件在网格员见证下接走，家长事后电话确认',
          lockedSnapshot: {
            reservation: { id: saved.id, date: day, arrivalSlot: slot, plannedLeave: leave, leaveMode: mode, seat: saved.seatId ? '历史座位' : null },
            student: { id: stu.id, name: stu.name, grade: stu.grade },
            late: [{ type: 'late', detail: '晚到 20 分钟', by: '张志愿' }],
            patrolShifts: [{ recorderName: '赵安保', count: 2, areas: ['自习室全场', '出入口/监控死角'] }],
            volunteerShifts: [{ volunteerName: '陈晓志愿者', startTime: '18:30', endTime: '21:00' }],
            incidentId: inc.id, lockedAt: shTime(day, '20:35'),
          },
        }));
        const act = (t: any, name: string, role: string, hm: string, detail: string) =>
          pcActs.save(pcActs.create({ pickupCaseId: pc.id, type: t, actorName: name, actorRole: role, time: shTime(day, hm), detail }));
        await act('open', '李社工', 'staff', '20:35', '到计划离场时间家长未到，开单并锁定现场');
        await act('contact_attempt', '李社工', 'staff', '20:36', '未接通（电话）');
        await act('contact_attempt', '张志愿', 'volunteer', '20:45', '未接通（电话）');
        await act('temp_care', '李社工', 'staff', '20:50', '转入临时看护（社区临时看护室）');
        await act('escalate', '赵安保', 'security', '20:55', '家长 3 次未接，升级网格员孙网格员');
        await act('parent_reply', '郑华', 'parent', '21:05', '加班没看手机，已委托姑姑去接');
        await act('resolve', '孙网格员', 'staff', '21:20', '姑姑凭证件接走，该家庭独自离场权限已限制');
        // 学生档案同步：累计风险并限制独自离场
        stu.pickupRiskCount += 1;
        stu.soloPickupRestricted = true;
        await students.save(stu);
        }
      }
    }
  }

  // ---------- 当日演示数据 ----------
  // 1) 周小川已入场（安静区 Q-01），自习中，且有一个进行中的设备丢失协同事件
  const rIn = await reserv.save(reserv.create({
    date: today, arrivalSlot: '16:30-17:00', plannedLeave: '19:00', leaveMode: 'solo',
    studentId: s2.id, parentId: p1.id, roomId: room.id,
    seatId: seatList.find(s => s.code === 'Q-01')!.id,
    status: 'checked_in', reconfirmed: true, checkedInAt: shTime(today, '16:40'),
    authVerified: true, belongingsChecked: true, leaveModeVerified: true,
    checkInOperator: '李社工', emergencyContact: s2.emergencyContact, emergencyPhone: s2.emergencyPhone,
  }));
  await events.save(events.create({
    reservationId: rIn.id, type: 'charger', detail: '借用充电器一个',
    occurredAt: shTime(today, '17:20'), recorderName: '张志愿',
  }));
  const incOpen = await incidents.save(incidents.create({
    date: today, type: 'device_lost', title: '周小川报称电子词典不见了',
    description: '17:10 左右离开座位打水，回来后发现桌上电子词典不在。',
    status: 'responding', escalated: true, reservationId: rIn.id, studentId: s2.id,
    openedByName: '张志愿',
  }));
  await msgs.save([
    msgs.create({ incidentId: incOpen.id, authorName: '张志愿', authorRole: 'volunteer', content: '已安抚学生并登记物品特征：白色电子词典。' }),
    msgs.create({ incidentId: incOpen.id, authorName: '赵安保', authorRole: 'security', content: '正在调取 W 区与饮水间监控。' }),
  ]);

  // 2) 周小雨已确认待入场（家长接，低龄→自动分配低龄陪护区）
  await reserv.save(reserv.create({
    date: today, arrivalSlot: '18:00-18:30', plannedLeave: '20:30', leaveMode: 'pickup',
    studentId: s1.id, parentId: p1.id, status: 'confirmed', reconfirmed: true,
    allergies: '花生过敏', careNote: '低龄，请安排低龄陪护区',
    emergencyContact: '周敏（妈妈）', emergencyPhone: '13900000001',
  }));
  // 3) 吴小天已确认待入场（独自离场）
  await reserv.save(reserv.create({
    date: today, arrivalSlot: '16:30-17:00', plannedLeave: '18:30', leaveMode: 'solo',
    studentId: s3.id, parentId: p2.id, status: 'confirmed', reconfirmed: true,
    emergencyContact: '吴磊（爸爸）', emergencyPhone: '13900000002',
  }));
  // 4) 郑乐乐为重点关注学生：预约待家长重新确认
  await reserv.save(reserv.create({
    date: today, arrivalSlot: '18:30-19:00', plannedLeave: '20:00', leaveMode: 'pickup',
    studentId: s4.id, parentId: p3.id, status: 'pending', reconfirmed: false,
    allergies: '青霉素过敏', careNote: '重点关注，需家长重新确认',
    emergencyContact: '郑华（妈妈）', emergencyPhone: '13900000003',
  }));

  await patrols.save(patrols.create({
    time: shTime(today, '17:30'), area: '自习室全场', finding: '', normal: true,
    roomId: room.id, recorderName: '赵安保',
  }));

  console.log('[seed] 演示数据播种完成');
  return true;
}

// 允许独立执行：node dist/seed.js
if (require.main === module) {
  (async () => {
    const ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'db',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USER || 'studyroom',
      password: process.env.DB_PASSWORD || 'studyroom',
      database: process.env.DB_NAME || 'studyroom',
      entities: [User, Student, Room, Seat, OpenSchedule, VolunteerShift, Reservation,
        StudyEvent, Incident, IncidentMessage, Patrol, PickupCase, PickupAction],
    });
    await ds.initialize();
    await runSeed(ds);
    await ds.destroy();
  })().catch(e => { console.error(e); process.exit(1); });
}
