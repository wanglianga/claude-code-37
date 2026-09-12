import { Body, Controller, Get, Post, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DbService } from './db.service';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private db: DbService, private jwt: JwtService) {}

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    const user = await this.db.users.findOneBy({ username: body.username || '' });
    if (!user || !(await bcrypt.compare(body.password || '', user.passwordHash))) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const payload = { sub: user.id, username: user.username, name: user.name, role: user.role, phone: user.phone };
    return { token: await this.jwt.signAsync(payload), user: payload };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
