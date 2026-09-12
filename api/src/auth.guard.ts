import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { UserRole } from './entities';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('缺少登录令牌');
    try {
      req.user = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    const roles = this.reflector.get<UserRole[]>(ROLES_KEY, ctx.getHandler());
    if (roles && roles.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException('当前角色无权执行该操作');
    }
    return true;
  }
}
