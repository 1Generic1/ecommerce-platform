import KeyvRedis from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keyv } from 'keyv';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        const logger = new Logger('CacheModule');

        if (!url) {
          // No Redis configured: fall back to in-memory. Fine for tests and
          // local work, wrong for multiple instances, where each would hold
          // its own copy and invalidation on one would not reach the others.
          logger.warn('REDIS_URL not set — using in-memory cache');
          return { stores: [new Keyv()] };
        }

        const store = new KeyvRedis(url);
        store.on('error', (err: Error) =>
          // Never throw: a Redis outage must degrade to cache misses, not
          // take down the API.
          logger.error(`Redis cache error: ${err.message}`),
        );

        return { stores: [new Keyv({ store })] };
      },
    }),
  ],
  exports: [CacheModule],
})
export class AppCacheModule {}
