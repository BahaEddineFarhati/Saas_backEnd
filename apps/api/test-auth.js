const API_URL = "http://localhost:3001/api/v1";

async function runLoginTests() {
  console.log("==================================================");
  console.log("   TESTING LOGIN PHASES & SCENARIOS              ");
  console.log("==================================================\n");

  const testEmail = `login-test-${Date.now()}@example.com`;
  const password = "SecurePassword123!";

  // 1. Setup: Register the user so they exist in the DB
  try {
    console.log(`[Setup] Registering test user: ${testEmail}...`);
    const regRes = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationName: "Acme Corp",
        firstName: "John",
        lastName: "Doe",
        email: testEmail,
        password: password
      })
    });
    const regData = await regRes.json();
    if (regRes.status === 201) {
      console.log("   User registered successfully!\n");
    } else {
      console.error("   Failed to register user:", regData);
      return;
    }
  } catch (err) {
    console.error("   Setup error:", err.message);
    return;
  }

  // PHASE 1: Missing Fields (Email/Password missing)
  try {
    console.log("PHASE 1: Testing Login with missing fields...");
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "",
        password: ""
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
    if (res.status === 400 && data.error.code === "INVALID_INPUT") {
      console.log("   ✅ Success: Returned 400 INVALID_INPUT\n");
    } else {
      console.log("   ❌ Fail: Unexpected response\n");
    }
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // PHASE 2: Non-existent User (Security check - must not expose user existence)
  try {
    console.log("PHASE 2: Testing Login with non-existent email...");
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "non-existent-user@example.com",
        password: password
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
    if (res.status === 401 && data.error.code === "INVALID_CREDENTIALS") {
      console.log("   ✅ Success: Returned 401 INVALID_CREDENTIALS (generic error)\n");
    } else {
      console.log("   ❌ Fail: Unexpected response\n");
    }
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // PHASE 3: Wrong Password
  try {
    console.log("PHASE 3: Testing Login with wrong password...");
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "IncorrectPassword123"
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
    if (res.status === 401 && data.error.code === "INVALID_CREDENTIALS") {
      console.log("   ✅ Success: Returned 401 INVALID_CREDENTIALS\n");
    } else {
      console.log("   ❌ Fail: Unexpected response\n");
    }
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // PHASE 4: Valid Login (Correct credentials)
  try {
    console.log("PHASE 4: Testing Login with correct credentials...");
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: password
      })
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
    if (res.status === 200 && data.success && data.data.accessToken) {
      console.log("   ✅ Success: Returned 200 OK with tokens!\n");
    } else {
      console.log("   ❌ Fail: Unexpected response\n");
    }
  } catch (err) {
    console.error("   Error:", err.message);
  }
}

runLoginTests();
