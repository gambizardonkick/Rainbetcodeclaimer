const firebaseDB = require('../server/firebaseDb.js');
const { initializeFirebase } = require('../server/firebase.js');

async function addTestAccount() {
  try {
    initializeFirebase();
    console.log('Adding test account: RobbingCasinos...');
    
    // Create user
    let user = await firebaseDB.findUserByTelegramId('test_user_robbingcasinos');
    
    if (!user) {
      user = await firebaseDB.createUser({
        telegramUserId: 'test_user_robbingcasinos',
        rainbetUsername: 'RobbingCasinos',
        status: 'active',
      });
      console.log(`✅ Created user: ${user.id}`);
    }
    
    // Create Rainbet account
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 10); // 10 year expiry for testing
    
    const account = await firebaseDB.createRainbetAccount({
      userId: user.id,
      username: 'robbingcasinos',
      status: 'active',
      expiryAt: expiryDate.toISOString(),
    });
    
    console.log(`✅ Created Rainbet account for RobbingCasinos`);
    console.log(`Account ID: ${account.id}`);
    console.log(`Status: ${account.status}`);
    console.log(`Expires: ${account.expiryAt}`);
    
    console.log('🎉 Test account added successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error adding test account:', error);
    process.exit(1);
  }
}

addTestAccount();
