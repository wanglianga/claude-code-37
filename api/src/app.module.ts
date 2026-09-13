import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  User, Student, Room, Seat, OpenSchedule, VolunteerShift, Reservation,
  StudyEvent, Incident, IncidentMessage, Patrol, PickupCase, PickupAction,
  SeatIssue, SeatIssueAction, PatrolFocus, MaintenanceItem,
} from './entities';
import { DbService } from './db.service';
import { AuthController } from './auth.controller';
import { HealthController } from './health.controller';
import { CatalogController } from './catalog.controller';
import { ReservationController } from './reservation.controller';
import { CollaborationController } from './collaboration.controller';
import { ArchiveController } from './archive.controller';
import { PickupController } from './pickup.controller';
import { SeatIssueController } from './seat-issue.controller';
import { OpsTasks } from './ops.tasks';

const entities = [
  User, Student, Room, Seat, OpenSchedule, VolunteerShift, Reservation,
  StudyEvent, Incident, IncidentMessage, Patrol, PickupCase, PickupAction,
  SeatIssue, SeatIssueAction, PatrolFocus, MaintenanceItem,
];

const dbProvider = {
  provide: DataSource,
  useFactory: async () => {
    const ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'db',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USER || 'studyroom',
      password: process.env.DB_PASSWORD || 'studyroom',
      database: process.env.DB_NAME || 'studyroom',
      entities,
      synchronize: true,
    });
    // 等待数据库就绪（compose 中 db 启动有时延）
    for (let i = 0; i < 30; i++) {
      try { await ds.initialize(); return ds; }
      catch (e) {
        console.log(`[db] 等待数据库就绪 (${i + 1}/30)...`);
        try { await ds.destroy(); } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    await ds.initialize();
    return ds;
  },
};

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'studyroom-dev-secret',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [
    HealthController, AuthController, CatalogController, ReservationController,
    CollaborationController, ArchiveController, PickupController, SeatIssueController,
  ],
  providers: [dbProvider, DbService, OpsTasks],
})
export class AppModule {}
