const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const c = await p.passwordResetToken.count();
    console.log('count', c);
  } catch (e) {
    console.error('ERROR', e.message);
    console.error(e);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
})();
