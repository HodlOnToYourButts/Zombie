#!/usr/bin/env node

require('dotenv').config();
const database = require('../src/database');
const User = require('../src/models/User');

async function addUser() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node scripts/add-user.js <username> <email> <password> [groups] [roles]');
    console.log('Example: node scripts/add-user.js admin admin@example.com password123 "admin,users" "administrator"');
    process.exit(1);
  }

  const [username, email, password, groupsArg, rolesArg] = args;
  const groups = groupsArg ? groupsArg.split(',').map(g => g.trim()) : [];
  const roles = rolesArg ? rolesArg.split(',').map(r => r.trim()) : [];

  try {
    // Initialize database connection
    await database.initialize();
    
    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      console.error(`User with email ${email} already exists`);
      process.exit(1);
    }

    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      console.error(`User with username ${username} already exists`);
      process.exit(1);
    }

    // Create new user
    const passwordHash = await User.hashPassword(password);
    
    const user = new User({
      username,
      email,
      passwordHash,
      groups,
      roles,
      enabled: true,
      emailVerified: true
    });

    await user.save();
    
    console.log('User created successfully:');
    console.log(`  ID: ${user._id}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Groups: ${user.groups.join(', ')}`);
    console.log(`  Roles: ${user.roles.join(', ')}`);
    
  } catch (error) {
    console.error('Error creating user:', error.message);
    process.exit(1);
  }
}

// Interactive mode if no arguments provided
async function interactiveMode() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  try {
    console.log('Creating new user...\n');
    
    const username = await question('Username: ');
    const email = await question('Email: ');
    const password = await question('Password: ');
    const firstName = await question('First Name (optional): ');
    const lastName = await question('Last Name (optional): ');
    const groups = await question('Groups (comma-separated, optional): ');
    const roles = await question('Roles (comma-separated, optional): ');
    
    rl.close();
    
    // Initialize database connection
    await database.initialize();
    
    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      console.error(`\nUser with email ${email} already exists`);
      process.exit(1);
    }

    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      console.error(`\nUser with username ${username} already exists`);
      process.exit(1);
    }

    // Create user
    const passwordHash = await User.hashPassword(password);
    
    const user = new User({
      username,
      email,
      passwordHash,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      groups: groups ? groups.split(',').map(g => g.trim()) : [],
      roles: roles ? roles.split(',').map(r => r.trim()) : [],
      enabled: true,
      emailVerified: true
    });

    await user.save();
    
    console.log('\nUser created successfully:');
    console.log(`  ID: ${user._id}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Email: ${user.email}`);
    if (user.firstName) console.log(`  Name: ${user.firstName} ${user.lastName || ''}`);
    console.log(`  Groups: ${user.groups.join(', ')}`);
    console.log(`  Roles: ${user.roles.join(', ')}`);
    
  } catch (error) {
    console.error('\nError creating user:', error.message);
    process.exit(1);
  }
}

// Run appropriate mode
if (process.argv.length > 2) {
  addUser();
} else {
  interactiveMode();
}