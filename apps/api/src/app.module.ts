import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';

const DEV_JWT_SECRET = 'dev-secret-change-in-production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => {
        const required = ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV'];
        const missing = required.filter((key) => !config[key]);
        if (missing.length) {
          throw new Error(`Missing required env vars: ${missing.join(', ')}`);
        }

        const secret = config.JWT_SECRET;
        if (typeof secret !== 'string') {
          throw new Error('JWT_SECRET must be a string');
        }

        // Inverted on purpose: the strict rules run UNLESS we are
        // explicitly in development, so a missing or misspelled
        // NODE_ENV fails safe instead of skipping the check.
        if (config.NODE_ENV !== 'development') {
          if (secret === DEV_JWT_SECRET) {
            throw new Error('JWT_SECRET is still the development default');
          }
          if (secret.length < 32) {
            throw new Error(
              'JWT_SECRET must be at least 32 characters outside development',
            );
          }
        }

        return config;
      },
    }),
    // Global default: 100 requests per minute per IP.
    // Individual routes tighten this with @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}