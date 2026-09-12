import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class HealthController {
  constructor(private ds: DataSource) {}

  @Get('health')
  async health() {
    await this.ds.query('SELECT 1');
    return { status: 'ok', time: new Date().toISOString() };
  }
}
