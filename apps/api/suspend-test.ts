import { prisma } from './src/lib/prisma';
import { redis } from './src/lib/redis';

async function main() {
  const org = await prisma.organisation.findFirst({
    where: { slug: 'acme-corp' }
  });
  if (!org) {
    console.error("Organisation not found!");
    process.exit(1);
  }

  const nextSuspendedState = !org.suspended;

  await prisma.organisation.update({
    where: { id: org.id },
    data: {
      suspended: nextSuspendedState,
      suspendedAt: nextSuspendedState ? new Date() : null
    }
  });

  // Clear Redis Cache
  const cacheKey = `org_suspended:${org.id}`;
  await redis.del(cacheKey);

  console.log(`Organisation Acme Corp is now: ${nextSuspendedState ? 'SUSPENDED' : 'ACTIVE'}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
