const API_URL = "http://localhost:3001/api/v1";

async function runTests() {
  console.log("=== Starting Authentication Middleware Tests ===\n");

  // Scenario 1: Request without Authorization header
  try {
    console.log("1. Testing route without Authorization header...");
    const res = await fetch(`${API_URL}/protected-test`);
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data, null, 2)}\n`);
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // Scenario 2: Testing route with malformed token (e.g. Bearer abc123)
  try {
    console.log("2. Testing route with malformed token (Bearer abc123)...");
    const res = await fetch(`${API_URL}/protected-test`, {
      headers: { "Authorization": "Bearer abc123" }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data, null, 2)}\n`);
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // Scenario 3: Testing route with bad header format (NotBearer abc123)
  try {
    console.log("3. Testing route with bad header format (NotBearer abc123)...");
    const res = await fetch(`${API_URL}/protected-test`, {
      headers: { "Authorization": "NotBearer abc123" }
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data, null, 2)}\n`);
  } catch (err) {
    console.error("   Error:", err.message);
  }

  // Scenario 4: Register and Login to get a valid token
  try {
    const email = `test-${Date.now()}@example.com`;
    console.log(`4. Registering a new test user (${email})...`);
    const regRes = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationName: "Acme Corp",
        firstName: "John",
        lastName: "Doe",
        email: email,
        password: "SecurePassword123!"
      })
    });
    const regData = await regRes.json();
    console.log(`   Register Status: ${regRes.status}`);

    if (regRes.status !== 201) {
      console.log("Register response:", regData);
      return;
    }

    const token = regData.accessToken;
    console.log("   Successfully registered and received access token.");

    // Scenario 5: Access protected route with valid token
    console.log("\n5. Testing protected route with valid token...");
    const protRes = await fetch(`${API_URL}/protected-test`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const protData = await protRes.json();
    console.log(`   Status: ${protRes.status}`);
    console.log(`   Response: ${JSON.stringify(protData, null, 2)}\n`);
  } catch (err) {
    console.error("   Error:", err.message);
  }
}

runTests();
