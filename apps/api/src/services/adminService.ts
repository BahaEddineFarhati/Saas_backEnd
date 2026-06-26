import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { AppError } from "@/utils/AppError";

const SALT_ROUNDS = 12;
const VALID_PLANS = ['FREE', 'PRO', 'ENTERPRISE'];

/**
 * Create a new organisation with its admin user in a single transaction.
 */
export const createOrganisation = async (input: {
  organisationName: string;
  slug: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
}) => {
  const {
    organisationName,
    slug,
    adminFirstName,
    adminLastName,
    adminEmail,
    adminPassword,
  } = input;

  // Check if slug already exists
  const existingOrg = await prisma.organisation.findUnique({
    where: { slug },
  });
  if (existingOrg) {
    throw new AppError("Organisation slug already taken", 409, "SLUG_TAKEN");
  }

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: adminEmail },
  });
  if (existingUser) {
    throw new AppError("Email already in use", 409, "EMAIL_TAKEN");
  }

  const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    const organisation = await tx.organisation.create({
      data: {
        name: organisationName,
        slug,
      },
    });

    const user = await tx.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: adminFirstName,
        lastName: adminLastName,
        role: "ADMIN",
        organisationId: organisation.id,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        organisationId: true,
        createdAt: true,
      },
    });

    return { organisation, user };
  });

  return result;
};

/**
 * List organisations with pagination, search, and suspension filter.
 */
export const listOrganisations = async (query: {
  suspended?: string;
  search?: string;
  page?: string;
  limit?: string;
}) => {
  const page = Math.max(1, parseInt(query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
  const skip = (page - 1) * limit;

  // Build where clause
  const where: any = {};

  if (query.suspended === "true") {
    where.suspended = true;
  } else if (query.suspended === "false") {
    where.suspended = false;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { slug: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [organisations, total] = await Promise.all([
    prisma.organisation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        suspended: true,
        suspendedAt: true,
        createdAt: true,
        _count: {
          select: {
            users: true,
            jobOpenings: true,
          },
        },
      },
    }),
    prisma.organisation.count({ where }),
  ]);

  // For each org, count candidates (CVs analysed) linked to their job openings
  const orgsWithCvCount = await Promise.all(
    organisations.map(async (org) => {
      const cvsAnalysed = await prisma.candidate.count({
        where: {
          jobOpening: {
            organisationId: org.id,
          },
        },
      });
      return {
        ...org,
        _count: {
          ...org._count,
          cvsAnalysed,
        },
      };
    })
  );

  return {
    data: orgsWithCvCount,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get full details of a single organisation by ID.
 */
export const getOrganisationById = async (orgId: string) => {
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    include: {
      users: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          jobOpenings: true,
        },
      },
    },
  });

  if (!org) {
    throw new AppError("Organisation not found", 404, "NOT_FOUND");
  }

  // Count candidates linked to this org's job openings
  const candidateCount = await prisma.candidate.count({
    where: {
      jobOpening: {
        organisationId: orgId,
      },
    },
  });

  return {
    ...org,
    _count: {
      ...org._count,
      candidates: candidateCount,
    },
  };
};

/**
 * Partial update of an organisation.
 */
export const updateOrganisation = async (
  orgId: string,
  data: { name?: string; slug?: string; plan?: string }
) => {
  // Check org exists
  const existing = await prisma.organisation.findUnique({
    where: { id: orgId },
  });
  if (!existing) {
    throw new AppError("Organisation not found", 404, "NOT_FOUND");
  }

  // If slug is changing, check uniqueness
  if (data.slug && data.slug !== existing.slug) {
    const slugTaken = await prisma.organisation.findUnique({
      where: { slug: data.slug },
    });
    if (slugTaken) {
      throw new AppError("Organisation slug already taken", 409, "SLUG_TAKEN");
    }
  }

  // Validate plan if provided
  if (data.plan !== undefined && !VALID_PLANS.includes(data.plan)) {
    throw new AppError(
      `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.slug !== undefined) updateData.slug = data.slug;
  if (data.plan !== undefined) updateData.plan = data.plan;

  const updated = await prisma.organisation.update({
    where: { id: orgId },
    data: updateData,
  });

  return updated;
};

/**
 * Suspend an organisation:
 * 1. Set suspended = true, suspendedAt = now()
 * 2. Delete all refresh tokens for org users (force re-auth)
 * 3. Update Redis cache so the auth middleware blocks requests immediately
 */
export const suspendOrganisation = async (orgId: string, reason?: string) => {
  const existing = await prisma.organisation.findUnique({
    where: { id: orgId },
  });
  if (!existing) {
    throw new AppError("Organisation not found", 404, "NOT_FOUND");
  }
  if (existing.suspended) {
    throw new AppError("Organisation is already suspended", 400, "ALREADY_SUSPENDED");
  }

  const updated = await prisma.organisation.update({
    where: { id: orgId },
    data: {
      suspended: true,
      suspendedAt: new Date(),
      suspendedReason: reason || null,
    },
  });

  // Revoke all refresh tokens for users belonging to this org
  await prisma.refreshToken.deleteMany({
    where: {
      user: {
        organisationId: orgId,
      },
    },
  });

  // Update Redis cache immediately
  await redis.set(`org_suspended:${orgId}`, "true", "EX", 60);

  return updated;
};

/**
 * Unsuspend an organisation:
 * 1. Set suspended = false, suspendedAt = null
 * 2. Remove the Redis cache entry
 */
export const unsuspendOrganisation = async (orgId: string) => {
  const existing = await prisma.organisation.findUnique({
    where: { id: orgId },
  });
  if (!existing) {
    throw new AppError("Organisation not found", 404, "NOT_FOUND");
  }
  if (!existing.suspended) {
    throw new AppError("Organisation is not suspended", 400, "NOT_SUSPENDED");
  }

  const updated = await prisma.organisation.update({
    where: { id: orgId },
    data: {
      suspended: false,
      suspendedAt: null,
      suspendedReason: null,
    },
  });

  // Remove Redis cache
  await redis.del(`org_suspended:${orgId}`);

  return updated;
};

/**
 * Get platform-wide statistics (all real DB counts, no hardcoded values).
 */
export const getStats = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalOrganisations,
    activeOrganisations,
    suspendedOrganisations,
    totalUsers,
    totalCVsAnalysed,
    totalCVsThisMonth,
    totalJobOpenings,
    activeJobOpenings,
  ] = await Promise.all([
    prisma.organisation.count(),
    prisma.organisation.count({ where: { suspended: false } }),
    prisma.organisation.count({ where: { suspended: true } }),
    prisma.user.count({ where: { role: { not: "SUPER_ADMIN" } } }),
    prisma.candidate.count(),
    prisma.candidate.count({
      where: { createdAt: { gte: startOfMonth } },
    }),
    prisma.jobOpening.count(),
    prisma.jobOpening.count({ where: { status: "OPEN" } }),
  ]);

  return {
    totalOrganisations,
    activeOrganisations,
    suspendedOrganisations,
    totalUsers,
    totalCVsAnalysed,
    totalCVsThisMonth,
    totalJobOpenings,
    activeJobOpenings,
  };
};
