import { prisma } from '../src/lib/prisma';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

async function main() {
  try {
    console.log('🌱 Starting database seeding...\n');

    // 0. Upsert Super Admin (no organisation)
    console.log('🦸 Upserting SUPER_ADMIN user...');
    const existingSuperAdmin = await prisma.user.findUnique({
      where: { email: 'superadmin@linkup.tn' },
    });
    const superAdminPasswordHash = await bcrypt.hash('SuperAdmin1234!', SALT_ROUNDS);
    const superAdmin = await prisma.user.upsert({
      where: { email: 'superadmin@linkup.tn' },
      update: {},
      create: {
        email: 'superadmin@linkup.tn',
        passwordHash: superAdminPasswordHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        organisationId: null,
        isActive: true,
      },
    });
    const superAdminStatus = existingSuperAdmin ? 'already exists' : 'created';
    console.log(`✓ Super Admin: ${superAdminStatus} - ${superAdmin.email}\n`);

    // 1. Upsert Organisation
    console.log('📋 Upserting Organisation...');
    const existingOrg = await prisma.organisation.findUnique({
      where: { slug: 'acme-recruiting' },
    });
    const organisation = await prisma.organisation.upsert({
      where: { slug: 'acme-recruiting' },
      update: {},
      create: {
        name: 'Acme Recruiting',
        slug: 'acme-recruiting',
        plan: 'PRO',
      },
    });
    const orgStatus = existingOrg ? 'already exists' : 'created';
    console.log(`✓ Organisation: ${orgStatus} - ${organisation.name}\n`);

    // 2. Upsert ADMIN User
    console.log('👤 Upserting ADMIN user...');
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'admin@acme.com' },
    });
    const adminPassword = 'Admin1234!';
    const adminPasswordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@acme.com' },
      update: {},
      create: {
        email: 'admin@acme.com',
        passwordHash: adminPasswordHash,
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        organisationId: organisation.id,
      },
    });
    const adminStatus = existingAdmin ? 'already exists' : 'created';
    console.log(`✓ Admin User: ${adminStatus} - ${adminUser.email}\n`);

    // 3. Upsert RECRUITER User
    console.log('👤 Upserting RECRUITER user...');
    const existingRecruiter = await prisma.user.findUnique({
      where: { email: 'recruiter@acme.com' },
    });
    const recruiterPassword = 'Recruiter1234!';
    const recruiterPasswordHash = await bcrypt.hash(recruiterPassword, SALT_ROUNDS);
    const recruiterUser = await prisma.user.upsert({
      where: { email: 'recruiter@acme.com' },
      update: {},
      create: {
        email: 'recruiter@acme.com',
        passwordHash: recruiterPasswordHash,
        firstName: 'Recruiter',
        lastName: 'User',
        role: 'RECRUITER',
        organisationId: organisation.id,
      },
    });
    const recruiterStatus = existingRecruiter ? 'already exists' : 'created';
    console.log(`✓ Recruiter User: ${recruiterStatus} - ${recruiterUser.email}\n`);

    // 4. Upsert JobOpening - Check if it exists first for idempotency
    console.log('💼 Upserting JobOpening...');
    let existingJobOpening = await prisma.jobOpening.findFirst({
      where: {
        title: 'Senior Software Engineer',
        organisationId: organisation.id,
      },
    });

    let jobOpening: any;
    let jobOpeningStatus: string;

    if (!existingJobOpening) {
      jobOpening = await prisma.jobOpening.create({
        data: {
          title: 'Senior Software Engineer',
          profileDescription:
            'We are looking for an experienced Senior Software Engineer to join our growing team. You will work on building scalable backend systems using modern technologies.',
          status: 'OPEN',
          organisationId: organisation.id,
          createdById: adminUser.id,
        },
      });
      jobOpeningStatus = 'created';
      console.log(`✓ JobOpening: created - ${jobOpening.title}\n`);
    } else {
      jobOpening = existingJobOpening;
      jobOpeningStatus = 'already exists';
      console.log(`✓ JobOpening: already exists - ${jobOpening.title}\n`);
    }

    console.log('✅ Database seeding completed successfully!\n');
    console.log('📊 Summary:');
    console.log(`   - Super Admin: ${superAdmin.email} - ${superAdminStatus}`);
    console.log(`   - Organisation: ${organisation.name} (${organisation.slug}) - ${orgStatus}`);
    console.log(`   - Admin User: ${adminUser.email} - ${adminStatus}`);
    console.log(`   - Recruiter User: ${recruiterUser.email} - ${recruiterStatus}`);
    console.log(`   - Job Opening: ${jobOpening.title} - ${jobOpeningStatus}`);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
