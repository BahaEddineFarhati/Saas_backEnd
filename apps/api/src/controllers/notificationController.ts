import { Request, Response } from "express";
import { catchAsync } from "@/utils/catchAsync";
import { AppError } from "@/utils/AppError";
import { prisma } from "@/lib/prisma";

export const listNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  const notifications = await prisma.notification.findMany({
    where: { userId, read: false },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      jobOpening: {
        select: { title: true },
      },
    },
  });

  res.status(200).json({
    success: true,
    data: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      jobOpeningId: notification.jobOpeningId,
      jobOpeningTitle: notification.jobOpening.title,
      read: notification.read,
      createdAt: notification.createdAt,
    })),
  });
});

export const markNotificationAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { notificationId } = req.params;

  if (!userId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    throw new AppError("Notification not found", 404, "NOT_FOUND");
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
    include: {
      jobOpening: {
        select: { title: true },
      },
    },
  });

  res.status(200).json({
    success: true,
    data: {
      id: updated.id,
      type: updated.type,
      title: updated.title,
      message: updated.message,
      jobOpeningId: updated.jobOpeningId,
      jobOpeningTitle: updated.jobOpening.title,
      read: updated.read,
      createdAt: updated.createdAt,
    },
  });
});

export const markAllNotificationsAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError("User not authenticated", 401, "UNAUTHORIZED");
  }

  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });

  res.status(200).json({
    success: true,
    data: { updated: true },
  });
});
