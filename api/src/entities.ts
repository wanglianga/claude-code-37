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
