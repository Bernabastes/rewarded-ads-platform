import { Controller, Get, HttpCode, Module, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/auth.decorators';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({
    schema: { example: { status: 'ok', version: '0.1.0', time: '2026-01-01T00:00:00.000Z' } },
  })
  live() {
    return { status: 'ok', version: this.config.env.APP_VERSION, time: new Date().toISOString() };
  }

  @Get('ready')
  @HttpCode(200)
  @ApiOperation({ summary: 'Readiness probe (database + redis)' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);
    const ok = database && redis;
    if (!ok) res.status(503);
    return { status: ok ? 'ready' : 'degraded', checks: { database, redis }, time: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
