import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, OneToMany, JoinColumn, Index,
} from 'typeorm';

// ---------- 身份与人员 ----------
export type UserRole = 'parent' | 'volunteer' | 'staff' | 'security' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) username: string;
  @Column() passwordHash: string;
  @Column() name: string;
  @Column({ type: 'varchar', length: 16 }) role: UserRole;
  @Column({ default: '' }) phone: string;
  /** 家庭级独自离场限制（家长账号标记，覆盖其全部孩子） */
  @Column({ default: false }) familySoloRestricted: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('students')
export class Student {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  /** 1-9 年级，数字越小越低龄 */
  @Column({ type: 'int' }) grade: number;
  @Column() school: string;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'parent_id' })
  parent?: User;
  @Column({ name: 'parent_id' }) parentId: number;
  @Column({ default: '' }) allergies: string;          // 过敏史
  @Column({ default: '' }) careNeeds: string;         // 特殊照护需求
  @Column({ default: '' }) emergencyContact: string;  // 紧急联系人
  @Column({ default: '' }) emergencyPhone: string;
  /** 长期异常 → 进入重点关注名单，后续预约需家长重新确认 */
  @Column({ default: false }) watchlisted: boolean;
  @Column({ type: 'int', default: 0 }) abnormalScore: number; // 累计异常分
  /** 晚间无人接历史累计次数（离场风险记录） */
  @Column({ type: 'int', default: 0 }) pickupRiskCount: number;
  /** 被社区限制独自离场（历史无人接处置后触发，后续 solo 预约需解除） */
  @Column({ default: false }) soloPickupRestricted: boolean;
  @CreateDateColumn() createdAt: Date;
}

// ---------- 场地 ----------
export type SeatZone = 'quiet' | 'window' | 'junior' | 'general'; // 安静区/临窗区/低龄陪护区/普通区

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ type: 'int' }) capacity: number;
  @Column({ default: true }) active: boolean;
  @OneToMany(() => Seat, s => s.room) seats: Seat[];
}

@Entity('seats')
export class Seat {
  @PrimaryGeneratedColumn() id: number;
  @Column() code: string;                 // A-01
  @Column({ type: 'varchar', length: 16 }) zone: SeatZone;
  @Column({ default: true }) monitored: boolean;   // 监控覆盖
  @ManyToOne(() => Room, r => r.seats, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'room_id' })
  room: Room;
  @Column({ name: 'room_id' }) roomId: number;
}

/** 社区开放时间（按星期几 + 时段，晚间时段有独立截止时间） */
@Entity('open_schedules')
export class OpenSchedule {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) weekday: number;   // 0=周日 … 6=周六
  @Column() openTime: string;                 // HH:mm
  @Column() closeTime: string;
  /** 允许低年级独自离场的最晚时间；为空表示当晚一律需家长接 */
  @Column({ default: null, nullable: true }) soloLeaveDeadline?: string;
  @Column({ default: true }) active: boolean;
}

/** 志愿者排班 */
@Entity('volunteer_shifts')
export class VolunteerShift {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column() startTime: string;
  @Column() endTime: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'volunteer_id' }) volunteer: User;
  @Column({ name: 'volunteer_id' }) volunteerId: number;
  @Column({ default: 12, type: 'int' }) careCapacity: number; // 该班可看护预约上限
}

// ---------- 预约 ----------
export type ReservationStatus =
  | 'pending'        // 待确认（重点关注学生等待家长重新确认）
  | 'confirmed'      // 已生成预约
  | 'checked_in'     // 已入场
  | 'checked_out'    // 已离场
  | 'no_show'        // 未到
  | 'cancelled';

export type LeaveMode = 'solo' | 'pickup'; // 独自离场 / 家长接

@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column() arrivalSlot: string;   // 到场时段，如 18:00-18:30
  @Column() plannedLeave: string;  // 计划离场时间 HH:mm
  @Column({ type: 'varchar', length: 16 }) leaveMode: LeaveMode;
  /** 预约时登记的临时照护信息（可覆盖学生档案） */
  @Column({ default: '' }) emergencyContact: string;
  @Column({ default: '' }) emergencyPhone: string;
  @Column({ default: '' }) allergies: string;
  @Column({ default: '' }) careNote: string;
  @Column({ type: 'varchar', length: 16, default: 'confirmed' }) status: ReservationStatus;
  @Column({ default: '' }) parentNote: string;      // 家长留言/改接说明
  /** 重点关注学生重新确认标记 */
  @Column({ default: false }) reconfirmed: boolean;
  @Column({ type: 'timestamptz', nullable: true }) reconfirmedAt?: Date;

  @ManyToOne(() => Student) @JoinColumn({ name: 'student_id' }) student: Student;
  @Column({ name: 'student_id' }) studentId: number;
  @ManyToOne(() => User) @JoinColumn({ name: 'parent_id' }) parent: User;
  @Column({ name: 'parent_id' }) parentId: number;
  @ManyToOne(() => Room, { nullable: true }) @JoinColumn({ name: 'room_id' }) room?: Room;
  @Column({ name: 'room_id', nullable: true }) roomId?: number;
  @ManyToOne(() => Seat, { nullable: true }) @JoinColumn({ name: 'seat_id' }) seat?: Seat;
  @Column({ name: 'seat_id', nullable: true }) seatId?: number;

  // 入场核验结果
  @Column({ type: 'timestamptz', nullable: true }) checkedInAt?: Date;
  @Column({ default: false }) authVerified: boolean;     // 家长授权核验
  @Column({ default: false }) belongingsChecked: boolean;// 随身物品核验
  @Column({ default: false }) leaveModeVerified: boolean;// 离场方式核验
  @Column({ default: '' }) checkInOperator: string;
  @Column({ default: '' }) checkInNote: string;

  // 离场
  @Column({ type: 'timestamptz', nullable: true }) checkedOutAt?: Date;
  @Column({ default: '' }) checkOutOperator: string;
  @Column({ type: 'varchar', length: 16, default: '' }) actualLeaveMode: string;
  /** 家长离场确认（电子签收） */
  @Column({ default: false }) parentConfirmed: boolean;
  @Column({ type: 'timestamptz', nullable: true }) parentConfirmedAt?: Date;

  @OneToMany(() => StudyEvent, e => e.reservation) events: StudyEvent[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// ---------- 自习过程记录（志愿者记录） ----------
export type StudyEventType =
  | 'late'            // 迟到
  | 'leave_seat'      // 离座
  | 'charger'         // 借用充电器
  | 'temp_out'        // 临时外出
  | 'unwell'          // 身体不适
  | 'parent_message'  // 家长留言
  | 'returned';       // 外出返回

@Entity('study_events')
export class StudyEvent {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 24 }) type: StudyEventType;
  @Column({ default: '' }) detail: string;
  @Column({ type: 'timestamptz' }) occurredAt: Date;
  @Column({ default: '' }) recorderName: string;
  @Column({ name: 'reservation_id' }) reservationId: number;
  @ManyToOne(() => Reservation, r => r.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reservation_id' }) reservation: Reservation;
  @CreateDateColumn() createdAt: Date;
}

// ---------- 跨角色协同事件 ----------
export type IncidentType =
  | 'no_show'         // 学生未到
  | 'pickup_change'   // 家长临时改接
  | 'night_unpicked'  // 晚间无人接
  | 'conflict'        // 同学冲突
  | 'device_lost'     // 电子设备丢失
  | 'power_outage'    // 自习室临时停电
  | 'late_return';    // 晚归

export type IncidentStatus = 'open' | 'responding' | 'resolved';

@Entity('incidents')
@Index(['date', 'status'])
export class Incident {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column({ type: 'varchar', length: 24 }) type: IncidentType;
  @Column() title: string;
  @Column({ default: '' }) description: string;
  @Column({ type: 'varchar', length: 16, default: 'open' }) status: IncidentStatus;
  @Column({ default: false }) escalated: boolean;
  @Column({ default: '' }) resolution: string;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt?: Date;
  @Column({ name: 'reservation_id', nullable: true }) reservationId?: number;
  @ManyToOne(() => Reservation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reservation_id' }) reservation?: Reservation;
  @Column({ name: 'student_id', nullable: true }) studentId?: number;
  @ManyToOne(() => Student, { nullable: true }) @JoinColumn({ name: 'student_id' }) student?: Student;
  @Column() openedByName: string;
  @OneToMany(() => IncidentMessage, m => m.incident, { cascade: true }) messages: IncidentMessage[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('incident_messages')
export class IncidentMessage {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'incident_id' }) incidentId: number;
  @ManyToOne(() => Incident, i => i.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' }) incident: Incident;
  @Column() authorName: string;
  @Column({ type: 'varchar', length: 16 }) authorRole: UserRole;
  @Column({ type: 'text' }) content: string;
  @CreateDateColumn() createdAt: Date;
}

// ---------- 安全巡查 ----------
@Entity('patrols')
export class Patrol {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'timestamptz' }) time: Date;
  @Column() area: string;
  @Column({ default: '' }) finding: string;       // 巡查发现
  @Column({ default: true }) normal: boolean;
  @Column({ name: 'room_id', nullable: true }) roomId?: number;
  @ManyToOne(() => Room, { nullable: true }) @JoinColumn({ name: 'room_id' }) room?: Room;
  @Column() recorderName: string;
  @CreateDateColumn() createdAt: Date;
}

// ---------- 晚间无人接处置 ----------
export type PickupStatus =
  | 'waiting'      // 继续等待家长
  | 'escorted'     // 志愿者陪同到门口
  | 'temp_care'    // 转入临时看护
  | 'escalated'    // 已升级网格员
  | 'resolved';    // 已接走并锁定

export type PickupActionType =
  | 'open'              // 开单
  | 'contact_attempt'   // 联系家长（未接通/已联系）
  | 'parent_reply'      // 家长回复
  | 'wait'              // 值班人员决定继续留守
  | 'escort'            // 陪同到门口
  | 'temp_care'         // 转入临时看护
  | 'escalate'          // 升级网格员
  | 'resolve';          // 接走并锁定

@Entity('pickup_cases')
export class PickupCase {
  @PrimaryGeneratedColumn() id: number;

  @Column({ name: 'reservation_id' }) reservationId: number;
  @ManyToOne(() => Reservation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reservation_id' }) reservation: Reservation;

  @Column({ name: 'student_id' }) studentId: number;
  @ManyToOne(() => Student) @JoinColumn({ name: 'student_id' }) student: Student;

  @Column({ type: 'date' }) date: string;
  @Column({ type: 'varchar', length: 16, default: 'waiting' }) status: PickupStatus;

  @Column({ type: 'timestamptz' }) openedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt?: Date;

  /** 授权离场方式 / 年级快照（决策依据） */
  @Column({ type: 'varchar', length: 16, default: 'pickup' }) authorizedLeaveMode: string;
  @Column({ type: 'int', default: 0 }) gradeSnapshot: number;

  /** 联系过程 */
  @Column({ type: 'int', default: 0 }) contactAttempts: number;
  @Column({ type: 'int', default: 0 }) contactReached: number;
  @Column({ default: '' }) lastParentReply: string;
  @Column({ type: 'timestamptz', nullable: true }) lastParentReplyAt?: Date;

  /** 值班/值守 */
  @Column({ default: '' }) dutyStaffName: string;
  @Column({ default: '' }) escortName: string;
  @Column({ default: '' }) tempCareLocation: string;
  @Column({ default: '' }) gridWorkerName: string;
  @Column({ type: 'timestamptz', nullable: true }) escalatedAt?: Date;

  /** 最终接走人（临时接送人）登记 */
  @Column({ default: '' }) pickupPersonName: string;
  @Column({ default: '' }) pickupPersonRelation: string;
  @Column({ default: '' }) pickupPersonPhone: string;
  @Column({ default: '' }) pickupPersonIdCard: string;  // 证件核验记录
  @Column({ default: false }) parentConfirmedPickup: boolean;

  /** 锁定的现场快照：迟到情况 / 临时接送人 / 当日巡查班次 / 预约 */
  @Column({ type: 'jsonb', nullable: true }) lockedSnapshot?: any;

  /** 处置结论对该家庭后续预约规则的影响 */
  @Column({ type: 'int', default: 0 }) riskAdded: number;
  @Column({ default: false }) soloRestrictedAfter: boolean;
  @Column({ default: '' }) resolution: string;

  @OneToMany(() => PickupAction, a => a.pickupCase, { cascade: true })
  actions: PickupAction[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('pickup_actions')
export class PickupAction {
  @PrimaryGeneratedColumn() id: number;

  @Column({ name: 'pickup_case_id' }) pickupCaseId: number;
  @ManyToOne(() => PickupCase, c => c.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pickup_case_id' }) pickupCase: PickupCase;

  @Column({ type: 'varchar', length: 24 }) type: PickupActionType;
  @Column({ default: '' }) detail: string;
  @Column() actorName: string;
  @Column({ type: 'varchar', length: 16 }) actorRole: string;
  @Column({ type: 'timestamptz' }) time: Date;
  @CreateDateColumn() createdAt: Date;
}

// ---------- 座位冲突 / 物品遗失 ----------
export type SeatIssueType = 'seat_conflict' | 'item_lost';
export type SeatIssueStatus = 'open' | 'responding' | 'resolved';

@Entity('seat_issues')
export class SeatIssue {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column({ type: 'varchar', length: 24 }) type: SeatIssueType;
  @Column() title: string;
  @Column({ default: '' }) description: string;
  @Column({ type: 'varchar', length: 16, default: 'open' }) status: SeatIssueStatus;

  @Column({ name: 'reservation_id' }) reservationId: number;
  @ManyToOne(() => Reservation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reservation_id' }) reservation: Reservation;
  @Column({ name: 'student_id' }) studentId: number;
  @ManyToOne(() => Student) @JoinColumn({ name: 'student_id' }) student: Student;

  /** 上报时座位 */
  @Column({ name: 'seat_id' }) seatId: number;
  @ManyToOne(() => Seat) @JoinColumn({ name: 'seat_id' }) seat: Seat;
  /** 调整后座位 */
  @Column({ name: 'new_seat_id', nullable: true }) newSeatId?: number;
  @ManyToOne(() => Seat) @JoinColumn({ name: 'new_seat_id' }) newSeat?: Seat;
  @Column({ name: 'room_id' }) roomId: number;

  /** 上下文快照：入场时间/座位分配/监控覆盖/同桌学生/当晚巡查/临时离场 */
  @Column({ type: 'jsonb', nullable: true }) context?: any;

  @Column({ default: false }) involvesBlindSpot: boolean; // 涉及监控盲区
  @Column({ default: false }) parentNotified: boolean;
  @Column({ default: '' }) parentReply: string;
  @Column({ default: '' }) resolution: string;
  @Column({ default: false }) itemFound: boolean;
  /** 结案后提频的区域 */
  @Column({ default: '' }) boostedZone: string;

  @Column() reportedByName: string;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt?: Date;
  @OneToMany(() => SeatIssueAction, a => a.issue, { cascade: true })
  actions: SeatIssueAction[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

export type SeatIssueActionType =
  | 'report'          // 学生反映/工作人员上报
  | 'reassign'        // 调整座位
  | 'start_search'    // 发起寻物
  | 'contact_parent'  // 联系家长
  | 'parent_reply'
  | 'note'
  | 'resolve';

@Entity('seat_issue_actions')
export class SeatIssueAction {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'seat_issue_id' }) issueId: number;
  @ManyToOne(() => SeatIssue, i => i.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seat_issue_id' }) issue: SeatIssue;
  @Column({ type: 'varchar', length: 24 }) type: SeatIssueActionType;
  @Column({ default: '' }) detail: string;
  @Column() actorName: string;
  @Column({ type: 'varchar', length: 16 }) actorRole: string;
  @Column({ type: 'timestamptz' }) time: Date;
  @CreateDateColumn() createdAt: Date;
}

/** 当晚巡查重点 / 频次提升区域（座位事件联动） */
@Entity('patrol_focuses')
export class PatrolFocus {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'date' }) date: string;
  @Column() area: string;                 // 巡查重点描述
  @Column({ default: '' }) zone: string; // 座位分区
  @Column({ name: 'room_id', nullable: true }) roomId?: number;
  @Column({ type: 'int', default: 30 }) frequencyMinutes: number; // 提高后的巡查频次
  @Column({ default: '' }) reason: string;
  @Column({ name: 'seat_issue_id', nullable: true }) seatIssueId?: number;
  @Column({ default: true }) active: boolean;
  @Column() createdByName: string;
  @CreateDateColumn() createdAt: Date;
}

/** 场地维护预算项（监控盲区整改等） */
@Entity('maintenance_items')
export class MaintenanceItem {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ default: '' }) area: string;
  @Column({ default: '' }) zone: string;
  @Column({ default: '' }) description: string;
  @Column({ default: 'monitor_blind_spot' }) category: string;
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) estimatedCost: number | string;
  /** proposed 待审批 / approved 已批准 / rejected 已驳回 / done 已完成 */
  @Column({ type: 'varchar', length: 16, default: 'proposed' }) status: string;
  @Column({ name: 'seat_issue_id', nullable: true }) seatIssueId?: number;
  @Column({ default: '' }) proposedByName: string;
  @Column({ default: '' }) approvedByName: string;
  @Column({ type: 'timestamptz', nullable: true }) approvedAt?: Date;
  @CreateDateColumn() createdAt: Date;
}
