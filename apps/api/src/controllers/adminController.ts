import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import { AppError } from "@/utils/AppError";
import * as adminService from "@/services/adminService";

/**
 * POST /api/v1/admin/organisations
 * Create a new organisation with its admin user.
 */
export const createOrganisation = catchAsync(
  async (req: Request, res: Response) => {
    const {
      organisationName,
      slug,
      adminFirstName,
      adminLastName,
      adminEmail,
      adminPassword,
    } = req.body;

    if (
      !organisationName ||
      !slug ||
      !adminFirstName ||
      !adminLastName ||
      !adminEmail ||
      !adminPassword
    ) {
      throw new AppError("All fields are required", 400, "VALIDATION_ERROR");
    }

    const result = await adminService.createOrganisation({
      organisationName,
      slug,
      adminFirstName,
      adminLastName,
      adminEmail,
      adminPassword,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  }
);

/**
 * GET /api/v1/admin/organisations
 * List organisations with pagination, search, and suspension filter.
 */
export const listOrganisations = catchAsync(
  async (req: Request, res: Response) => {
    const result = await adminService.listOrganisations({
      suspended: req.query.suspended as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page as string | undefined,
      limit: req.query.limit as string | undefined,
    });

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }
);

/**
 * GET /api/v1/admin/organisations/:orgId
 * Get full details of a single organisation.
 */
export const getOrganisationById = catchAsync(
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const result = await adminService.getOrganisationById(orgId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * PATCH /api/v1/admin/organisations/:orgId
 * Partial update of an organisation (name, slug, plan).
 */
export const updateOrganisation = catchAsync(
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const { name, slug, plan } = req.body;

    const result = await adminService.updateOrganisation(orgId, {
      name,
      slug,
      plan,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * POST /api/v1/admin/organisations/:orgId/suspend
 * Suspend an organisation (revokes sessions, caches suspension).
 */
export const suspendOrganisation = catchAsync(
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const result = await adminService.suspendOrganisation(orgId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * POST /api/v1/admin/organisations/:orgId/unsuspend
 * Unsuspend an organisation (clears cache).
 */
export const unsuspendOrganisation = catchAsync(
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const result = await adminService.unsuspendOrganisation(orgId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * GET /api/v1/admin/stats
 * Get platform-wide statistics.
 */
export const getStats = catchAsync(
  async (_req: Request, res: Response) => {
    const result = await adminService.getStats();

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);
