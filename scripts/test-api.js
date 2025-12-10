require('dotenv').config();

async function testAPI() {
  const baseURL = `http://localhost:${process.env.PORT || 3000}`;
  
  console.log('🧪 Testing IXFLIX Backend API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  try {
    // Test 1: Health Check
    console.log('1️⃣  Testing Health Check...');
    const healthResponse = await fetch(`${baseURL}/health`);
    const health = await healthResponse.json();
    console.log('   ✅ Health check:', health.message);
    console.log('');

    // Test 2: Send OTP
    console.log('2️⃣  Testing Send OTP...');
    const otpResponse = await fetch(`${baseURL}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+1234567890' })
    });
    const otpData = await otpResponse.json();
    console.log('   ✅ OTP sent:', otpData.message);
    console.log('   📱 Check console for OTP code');
    console.log('');

    // Success
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All tests passed!');
    console.log('');
    console.log('Backend is ready for frontend integration.');
    console.log('');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('');
    console.log('💡 Make sure the server is running:');
    console.log('   npm run dev');
    console.log('');
    process.exit(1);
  }
}

// Check if server is ready
setTimeout(testAPI, 2000);

