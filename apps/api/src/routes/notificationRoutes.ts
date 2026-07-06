import { Router } from "express";
import {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/controllers/notificationController";

const router = Router();

router.get("/", listNotifications);
router.patch("/:notificationId/read", markNotificationAsRead);
router.patch("/read-all", markAllNotificationsAsRead);

export default router;
