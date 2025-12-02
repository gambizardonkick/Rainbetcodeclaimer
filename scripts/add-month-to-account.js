const firebaseDB = require('../server/firebaseDb.js');
const { initializeFirebase } = require('../server/firebase.js');

async function addMonthToAccount() {
  const publicId = 'y3kpd0hr4hemz4yk2ggeez0l7kp7m99l';
  
  try {
    initializeFirebase();
    
    const accounts = await firebaseDB.findRainbetAccountsByPublicId(publicId);
    
    if (accounts.length === 0) {
      console.log(`No account found with publicId: ${publicId}`);
      process.exit(1);
    }
    
    const account = accounts[0];
    console.log('Found account:', account);
    
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1);
    
    const updated = await firebaseDB.updateRainbetAccount(account.id, {
      expiryAt: expiryDate.toISOString(),
      status: 'active'
    });
    
    console.log('Updated account with 1 month expiry:', updated);
    console.log(`New expiry date: ${expiryDate.toISOString()}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addMonthToAccount();
