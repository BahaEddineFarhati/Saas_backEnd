import bcrypt from 'bcrypt';
import { changeUserPassword } from '@/services/profileService';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    compare: jest.fn(),
    hash: jest.fn(),
  },
}));

jest.mock('@/utils/jwt', () => ({
  generateAccessToken: jest.fn(() => 'access-token'),
  generateRefreshToken: jest.fn(() => 'refresh-token'),
}));

describe('changeUserPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an incorrect current password with PROFILE_WRONG_PASSWORD', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      passwordHash: '$2b$12$dummyhash',
      organisationId: null,
      role: 'ADMIN',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      changeUserPassword('user-1', {
        currentPassword: 'wrong-current',
        newPassword: 'NewPassword123!',
        confirmNewPassword: 'NewPassword123!',
      })
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      changeUserPassword('user-1', {
        currentPassword: 'wrong-current',
        newPassword: 'NewPassword123!',
        confirmNewPassword: 'NewPassword123!',
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'PROFILE_WRONG_PASSWORD',
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
