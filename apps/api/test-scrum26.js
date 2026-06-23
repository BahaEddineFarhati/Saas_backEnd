const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const API_URL = "http://localhost:3001/api/v1";

async function runScrum26Tests() {
  console.log("==================================================");
  console.log("   TESTING SCRUM-26 (ORGANISATION & MEMBERS)     ");
  console.log("==================================================\n");

  const timestamp = Date.now();
  const adminEmail = `admin-${timestamp}@example.com`;
  const recruiterEmail = `recruiter-${timestamp}@example.com`;
  const password = "SecurePassword123!";

  let adminToken = "";
  let adminUserId = "";
  let adminOrgId = "";
  let recruiterUserId = "";
  let recruiterToken = "";
  let inviteTokenString = "";

  // 1. SETUP: Create Admin and Organisation directly in database
  try {
    console.log(`[Setup] Creating Organisation and Admin directly in DB...`);
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create Organisation
    const org = await prisma.organisation.create({
      data: {
        name: `Acme Corp ${timestamp}`,
        slug: `acme-corp-${timestamp}`,
      }
    });
    adminOrgId = org.id;

    // Create User
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: "Alice",
        lastName: "Smith",
        role: "ADMIN",
        organisationId: adminOrgId,
      }
    });
    adminUserId = admin.id;

    console.log(`   ✅ Success: DB Setup completed. Org ID: ${adminOrgId}, Admin ID: ${adminUserId}`);

    // Authenticate Admin to get access token
    console.log(`[Setup] Authenticating Admin to get token...`);
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: password
      })
    });
    const loginData = await loginRes.json();
    if (loginRes.status === 200 && loginData.data && loginData.data.accessToken) {
      adminToken = loginData.data.accessToken;
      console.log(`   ✅ Success: Admin authenticated successfully\n`);
    } else {
      console.error("   ❌ Fail: Setup authentication failed", loginData);
      return;
    }
  } catch (err) {
    console.error("   ❌ Fail: Setup error:", err.message);
    return;
  }

  // 2. TEST: GET /organisation (Admin)
  try {
    console.log("TEST 1: Fetching organisation details (GET /organisation)...");
    const res = await fetch(`${API_URL}/organisation`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 200 && data.success && data.data.name) {
      console.log(`   ✅ Success: Fetched org "${data.data.name}" with plan "${data.data.plan}"\n`);
    } else {
      console.log("   ❌ Fail: Could not fetch organisation", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 1:", err.message);
  }

  // 3. TEST: PATCH /organisation (Update Org details)
  try {
    console.log("TEST 2: Updating organisation details (PATCH /organisation)...");
    const res = await fetch(`${API_URL}/organisation`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Acme Updated ${timestamp}`,
        slug: `acme-updated-${timestamp}`
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 200 && data.success && data.data.slug === `acme-updated-${timestamp}`) {
      console.log("   ✅ Success: Organisation name and slug updated successfully\n");
    } else {
      console.log("   ❌ Fail: Could not update organisation", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 2:", err.message);
  }

  // 4. TEST: Slug Collision Conflict (409)
  try {
    console.log("TEST 3: Testing duplicate slug collision (expecting 409 SLUG_TAKEN)...");
    
    // Register a 2nd Org directly in DB
    const secondSlug = `second-org-${timestamp}`;
    await prisma.organisation.create({
      data: {
        name: `Second Org ${timestamp}`,
        slug: secondSlug,
      }
    });

    // Try to update Org 1's slug to secondSlug
    const res = await fetch(`${API_URL}/organisation`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ slug: secondSlug })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 409 && data.error.code === "SLUG_TAKEN") {
      console.log("   ✅ Success: Correctly rejected duplicate slug with 409 SLUG_TAKEN\n");
    } else {
      console.log("   ❌ Fail: Duplicate slug was not rejected properly", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 3:", err.message);
  }

  // 5. TEST: Invite Member (POST /organisation/members/invite)
  try {
    console.log("TEST 4: Inviting a new recruiter (POST /organisation/members/invite)...");
    const res = await fetch(`${API_URL}/organisation/members/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        email: recruiterEmail,
        role: "RECRUITER"
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 201 && data.success && data.data.id) {
      // Query the database to retrieve the secure token
      const inviteRecord = await prisma.inviteToken.findUnique({
        where: { id: data.data.id }
      });
      if (inviteRecord && inviteRecord.token) {
        inviteTokenString = inviteRecord.token;
        console.log(`   ✅ Success: Invitation created and token fetched from DB\n`);
      } else {
        console.log("   ❌ Fail: Invite token record not found in DB");
      }
    } else {
      console.log("   ❌ Fail: Could not invite recruiter", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 4:", err.message);
  }

  // 6. TEST: Duplicate Invite Conflict (409)
  try {
    console.log("TEST 5: Testing duplicate invite block (expecting 409)...");
    const res = await fetch(`${API_URL}/organisation/members/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        email: recruiterEmail,
        role: "RECRUITER"
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 409 && data.error.code === "INVITE_ALREADY_EXISTS") {
      console.log("   ✅ Success: Correctly blocked duplicate invite with 409 INVITE_ALREADY_EXISTS\n");
    } else {
      console.log("   ❌ Fail: Duplicate invite was not blocked properly", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 5:", err.message);
  }

  // 7. TEST: Get Members & Pending Invites (GET /organisation/members)
  try {
    console.log("TEST 6: Fetching organisation members list...");
    const res = await fetch(`${API_URL}/organisation/members`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    
    // Find virtual members
    const members = data.data.members || data.data;
    const pending = data.data.pendingInvites || [];
    
    const hasAdmin = members.some(m => m.id === adminUserId);
    const hasPendingInvite = pending.some(p => p.email === recruiterEmail);

    if (res.status === 200 && hasAdmin && hasPendingInvite) {
      console.log(`   ✅ Success: Retrieved members and found pending invite for "${recruiterEmail}"\n`);
    } else {
      console.log("   ❌ Fail: Members list incomplete", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 6:", err.message);
  }

  // 8. TEST: Accept Invite
  try {
    console.log("TEST 7: Accepting invitation to create user...");
    const res = await fetch(`${API_URL}/auth/accept-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteTokenString,
        firstName: "Jack",
        lastName: "Recruiter",
        password: password
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 201 && data.success && data.data && data.data.accessToken) {
      recruiterToken = data.data.accessToken;
      recruiterUserId = data.data.user.id;
      console.log(`   ✅ Success: Invite accepted. Recruiter ID: ${recruiterUserId}\n`);
    } else {
      console.log("   ❌ Fail: Could not accept invite", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 7:", err.message);
  }

  // 9. TEST: Verify RequireAdmin Middleware Blocks Recruiter
  try {
    console.log("TEST 8: Testing requireAdmin middleware on Recruiter (expecting 403)...");
    const res = await fetch(`${API_URL}/organisation`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${recruiterToken}`
      }
    });
    console.log(`   Status: ${res.status}`);
    if (res.status === 403) {
      console.log("   ✅ Success: Access blocked for recruiter with 403 Forbidden\n");
    } else {
      console.log("   ❌ Fail: Recruiter was incorrectly allowed access", res.status);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 8:", err.message);
  }

  // 10. TEST: Promote Recruiter to Admin (PATCH /organisation/members/:userId/role)
  try {
    console.log("TEST 9: Promoting recruiter to Admin...");
    const res = await fetch(`${API_URL}/organisation/members/${recruiterUserId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ role: "ADMIN" })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 200 && data.success && data.data.role === "ADMIN") {
      console.log("   ✅ Success: Recruiter promoted to ADMIN\n");
    } else {
      console.log("   ❌ Fail: Promotion failed", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 9:", err.message);
  }

  // 11. TEST: Demote Recruiter back to Recruiter
  try {
    console.log("TEST 10: Demoting user back to Recruiter...");
    const res = await fetch(`${API_URL}/organisation/members/${recruiterUserId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ role: "RECRUITER" })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 200 && data.success && data.data.role === "RECRUITER") {
      console.log("   ✅ Success: User demoted to RECRUITER\n");
    } else {
      console.log("   ❌ Fail: Demotion failed", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 10:", err.message);
  }

  // 12. TEST: Block Demoting Last Admin (expecting 400 LAST_ADMIN)
  try {
    console.log("TEST 11: Attempting to demote the last Admin (expecting 400 LAST_ADMIN)...");
    const res = await fetch(`${API_URL}/organisation/members/${adminUserId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ role: "RECRUITER" })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 400 && data.error.code === "LAST_ADMIN") {
      console.log("   ✅ Success: Correctly blocked demoting last admin with 400 LAST_ADMIN\n");
    } else {
      console.log("   ❌ Fail: Did not block demotion of last admin", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 11:", err.message);
  }

  // 13. TEST: Deactivate Recruiter Member (DELETE /organisation/members/:userId)
  try {
    console.log("TEST 12: Deactivating member account...");
    const res = await fetch(`${API_URL}/organisation/members/${recruiterUserId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 200 && data.success) {
      console.log("   ✅ Success: Recruiter member deactivated successfully\n");
    } else {
      console.log("   ❌ Fail: Deactivation failed", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 12:", err.message);
  }

  // 14. TEST: Block Deactivating Last Admin (expecting 400 LAST_ADMIN)
  try {
    console.log("TEST 13: Attempting to deactivate the last Admin (expecting 400 LAST_ADMIN)...");
    const res = await fetch(`${API_URL}/organisation/members/${adminUserId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.status === 400 && data.error.code === "LAST_ADMIN") {
      console.log("   ✅ Success: Correctly blocked deactivating last admin with 400 LAST_ADMIN\n");
    } else {
      console.log("   ❌ Fail: Did not block deactivating last admin", data);
    }
  } catch (err) {
    console.error("   ❌ Fail: Error during Test 13:", err.message);
  }

  // CLEANUP: Remove temp test data
  try {
    console.log("[Cleanup] Cleaning up test data from DB...");
    await prisma.inviteToken.deleteMany({ where: { email: recruiterEmail } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUserId, recruiterUserId] } } });
    await prisma.organisation.deleteMany({ where: { id: adminOrgId } });
    console.log("   ✅ Success: Cleanup complete\n");
  } catch (err) {
    console.warn("   ⚠️ Warning: Cleanup failed:", err.message);
  }

  console.log("==================================================");
  console.log("   SCRUM-26 TESTS COMPLETED                      ");
  console.log("==================================================");
  
  // Close prisma connection
  await prisma.$disconnect();
}

runScrum26Tests();
