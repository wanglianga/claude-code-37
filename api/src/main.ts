import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { runSeed } from './seed';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();

  // 首次启动自动播种演示数据（幂等）
  try {
    const ds = app.get(DataSource);
    await runSeed(ds);
  } catch (e) {
    console.error('[seed] 播种失败：', (e as Error).message);
  }

  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
  console.log('[api] listening on ' + (process.env.PORT || 3000));
}
bootstrap();
