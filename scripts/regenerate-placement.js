#!/usr/bin/env node

/**
 * Regenerate Placement Script
 * Regenerates genealogy placements based on network created_at, sponsor_id, and user active status.
 * Follows the same placement logic as user registration.
 *
 * Process:
 * 1. Clear existing genealogy placements (except root users if any)
 * 2. Get all users ordered by created_at (oldest first)
 * 3. For each active user, place them under their sponsor following registration logic
 * 4. Handle inactive users appropriately (skip placement or place at end)
 *
 * Usage: node backend/scripts/regenerate-placement.js [--dry-run] [--backup] [--restore-from-backup]
 */

require("dotenv").config({ path: ".env" });
const db = require("../src/config/database");
const Genealogy = require("../src/models/Genealogy");
const fs = require("fs").promises;
const path = require("path");

/**
 * Get next available position under sponsor within a transaction context
 * This replicates Genealogy.getNextAvailablePositionUnderSponsor but works with transactions
 */
async function getNextAvailablePositionUnderSponsorInTransaction(
  trx,
  sponsorId
) {
  try {
    // First, check sponsor's direct left/right positions
    const leftAvailable = await isPositionAvailableInTransaction(
      trx,
      sponsorId,
      "left"
    );
    if (leftAvailable) {
      return { parentId: sponsorId, position: "left" };
    }

    const rightAvailable = await isPositionAvailableInTransaction(
      trx,
      sponsorId,
      "right"
    );
    if (rightAvailable) {
      return { parentId: sponsorId, position: "right" };
    }

    // Both direct positions are filled, alternate between left and right subtrees
    // Count how many users are already placed under this sponsor (excluding the 2 direct children)
    const allDownlines = await getDownlineInTransaction(trx, sponsorId);
    const downlineCount = allDownlines.length - 2; // Subtract the 2 direct children

    // Alternate between left and right subtrees
    // Even count (0, 2, 4...) = left subtree, Odd count (1, 3, 5...) = right subtree
    const useLeftSubtree = downlineCount % 2 === 0;

    if (useLeftSubtree) {
      // Find available position in left subtree using breadth-first search
      return await findAvailablePositionBreadthFirstInTransaction(
        trx,
        sponsorId,
        "left"
      );
    } else {
      // Find available position in right subtree using breadth-first search
      return await findAvailablePositionBreadthFirstInTransaction(
        trx,
        sponsorId,
        "right"
      );
    }
  } catch (error) {
    console.error(
      "Error getting next available position under sponsor in transaction:",
      error
    );
    throw error;
  }
}

/**
 * Check if position is available within transaction
 */
async function isPositionAvailableInTransaction(trx, parentId, position) {
  try {
    const existing = await trx("genealogy")
      .where("parent_id", parentId)
      .where("position", position)
      .first();

    return !existing; // Return true if position is available
  } catch (error) {
    console.error(
      "Error checking position availability in transaction:",
      error
    );
    throw error;
  }
}

/**
 * Get downline within transaction
 */
async function getDownlineInTransaction(trx, userId) {
  try {
    const downline = [];
    const queue = [{ id: userId, level: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();

      const children = await trx("genealogy")
        .where("parent_id", current.id)
        .join("users", "genealogy.user_id", "users.id")
        .select("genealogy.user_id as user_id", "users.name")
        .where("users.is_active", true);

      for (const child of children) {
        downline.push({
          user_id: child.user_id,
          level: current.level + 1,
        });
        queue.push({ id: child.user_id, level: current.level + 1 });
      }
    }

    return downline;
  } catch (error) {
    console.error("Error getting downline in transaction:", error);
    throw error;
  }
}

/**
 * Find available position in subtree using breadth-first search within transaction
 */
async function findAvailablePositionBreadthFirstInTransaction(
  trx,
  sponsorId,
  subtreePosition
) {
  try {
    // Get the root of the subtree (sponsor's child in the specified position)
    const subtreeRoot = await trx("genealogy")
      .where("parent_id", sponsorId)
      .where("position", subtreePosition)
      .join("users", "genealogy.user_id", "users.id")
      .select("genealogy.user_id as id")
      .where("users.is_active", true)
      .first();

    if (!subtreeRoot) {
      // This shouldn't happen if we're calling this function, but handle it
      return { parentId: sponsorId, position: subtreePosition };
    }

    // Follow the spine: left subtree uses left positions, right subtree uses right positions
    // Traverse down the spine until we find an available position
    let currentNodeId = subtreeRoot.id;

    while (true) {
      // Check the position that matches the subtree side
      const positionToCheck = subtreePosition; // 'left' for left subtree, 'right' for right subtree
      const available = await isPositionAvailableInTransaction(
        trx,
        currentNodeId,
        positionToCheck
      );

      if (available) {
        return { parentId: currentNodeId, position: positionToCheck };
      }

      // Position is taken, find the child in that position and continue down the spine
      const child = await trx("genealogy")
        .where("parent_id", currentNodeId)
        .where("position", positionToCheck)
        .join("users", "genealogy.user_id", "users.id")
        .select("genealogy.user_id as id")
        .where("users.is_active", true)
        .first();

      if (!child) {
        // This shouldn't happen if position is not available, but handle it
        return { parentId: currentNodeId, position: positionToCheck };
      }

      currentNodeId = child.id;
    }
  } catch (error) {
    console.error(
      "Error finding available position breadth-first in transaction:",
      error
    );
    throw error;
  }
}

async function regeneratePlacement(
  dryRun = false,
  createBackup = false,
  restoreFromBackup = false
) {
  console.log(
    "🔄 Regenerating genealogy placements based on network created_at and sponsor_id...\n"
  );

  if (dryRun) {
    console.log("🧪 DRY RUN MODE - No changes will be made to the database");
  }

  try {
    // Step 1: Restore from backup if requested
    if (restoreFromBackup && !dryRun) {
      console.log("🔄 Attempting to restore genealogy from backup...");
      const backupPath = path.join(__dirname, "..", "backups");

      try {
        const backupFiles = await fs.readdir(backupPath);
        const genealogyBackups = backupFiles
          .filter((file) => file.startsWith("genealogy-backup-"))
          .sort()
          .reverse(); // Most recent first

        if (genealogyBackups.length > 0) {
          const latestBackup = genealogyBackups[0];
          const backupFilePath = path.join(backupPath, latestBackup);

          console.log(`📖 Reading backup file: ${latestBackup}`);
          const backupData = JSON.parse(
            await fs.readFile(backupFilePath, "utf8")
          );

          console.log(`🔄 Restoring ${backupData.length} genealogy records...`);

          // Clear existing data and restore from backup
          await db("genealogy").del();

          for (const record of backupData) {
            await db("genealogy").insert({
              user_id: record.user_id,
              parent_id: record.parent_id,
              sponsor_id: record.sponsor_id,
              position: record.position,
              created_at: record.created_at || new Date(),
              updated_at: record.updated_at || new Date(),
            });
          }

          console.log("✅ Genealogy data restored from backup");
          console.log("🔄 Continuing with placement regeneration...");
        } else {
          console.log("⚠️  No backup files found to restore from");
        }
      } catch (error) {
        console.error("❌ Failed to restore from backup:", error.message);
        console.log("🔄 Continuing without backup restoration...");
      }
    }

    // Step 2: Create backup if requested (after potential restore)
    if (createBackup && !dryRun) {
      console.log("💾 Creating genealogy backup...");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(__dirname, "..", "backups");

      // Ensure backups directory exists
      await fs.mkdir(backupPath, { recursive: true });

      const backupFile = path.join(
        backupPath,
        `genealogy-backup-${timestamp}.json`
      );

      const currentGenealogy = await db("genealogy")
        .join("users", "genealogy.user_id", "users.id")
        .select(
          "genealogy.*",
          "users.name",
          "users.email",
          "users.created_at as user_created_at",
          "users.is_active"
        );

      await fs.writeFile(backupFile, JSON.stringify(currentGenealogy, null, 2));
      console.log(`✅ Backup saved to: ${backupFile}`);
    }

    // Step 2: Try to get existing genealogy data to capture sponsor relationships
    console.log("📊 Gathering existing genealogy data...");
    const existingGenealogy = await db("genealogy").select(
      "user_id",
      "sponsor_id",
      "parent_id",
      "position"
    );

    console.log(
      `📊 Found ${existingGenealogy.length} existing genealogy records`
    );

    // Create a map of user_id -> sponsor_id
    const sponsorMap = new Map();
    let genealogyExists = false;

    existingGenealogy.forEach((record) => {
      if (record.sponsor_id && record.sponsor_id !== record.user_id) {
        sponsorMap.set(record.user_id, record.sponsor_id);
        genealogyExists = true;
      }
    });

    console.log(
      `✅ Found ${sponsorMap.size} sponsor relationships from existing genealogy`
    );

    // If no genealogy data exists, try to restore from backup or reconstruct
    if (!genealogyExists) {
      console.log("⚠️  No existing genealogy data found in database.");

      // Check if there's a recent backup to restore from
      const backupPath = path.join(__dirname, "..", "backups");
      try {
        const backupFiles = await fs.readdir(backupPath);
        const genealogyBackups = backupFiles
          .filter((file) => file.startsWith("genealogy-backup-"))
          .sort()
          .reverse(); // Most recent first

        if (genealogyBackups.length > 0) {
          const latestBackup = genealogyBackups[0];
          console.log(`💾 Found backup file: ${latestBackup}`);
          console.log(
            "💡 Consider restoring from backup before running this script:"
          );
          console.log(
            `   cp ${path.join(
              backupPath,
              latestBackup
            )} /tmp/genealogy-restore.json`
          );
          console.log(
            "   # Then manually restore the data or modify this script to restore automatically"
          );
        }
      } catch (error) {
        // Backups directory doesn't exist or can't be read
      }

      // Alternative: Try to reconstruct sponsor relationships using heuristics
      console.log(
        "🔍 Attempting to reconstruct sponsor relationships using creation order..."
      );

      const allUsers = await db("users")
        .select("id", "referral_code", "created_at")
        .orderBy("created_at", "asc");

      // For each user after the first, assign the previous user as sponsor
      // This creates a simple linear chain: user2 sponsored by user1, user3 by user2, etc.
      for (let i = 1; i < allUsers.length; i++) {
        const user = allUsers[i];
        const previousUser = allUsers[i - 1];
        sponsorMap.set(user.id, previousUser.id);
        console.log(
          `     🔗 Reconstructed: User ${user.id} sponsored by User ${previousUser.id}`
        );
      }

      console.log(
        `✅ Created ${sponsorMap.size} sponsor relationships using linear chain fallback`
      );
      console.log(
        "⚠️  WARNING: This creates a simple chain structure, not the original network."
      );
      console.log(
        "💡 For accurate results, ensure genealogy table has sponsor data before running."
      );
    }

    // Step 3: Get all users ordered by created_at (oldest first)
    console.log("📊 Gathering users ordered by creation date...");
    const allUsers = await db("users")
      .select("id", "name", "email", "referral_code", "is_active", "created_at")
      .orderBy("created_at", "asc");

    console.log(`✅ Found ${allUsers.length} total users`);

    // Step 4: Separate active and inactive users
    const activeUsers = allUsers.filter((user) => user.is_active);
    const inactiveUsers = allUsers.filter((user) => !user.is_active);

    console.log(`✅ Active users: ${activeUsers.length}`);
    console.log(
      `⚠️  Inactive users: ${inactiveUsers.length} (will be placed after active users)`
    );

    // Step 4: Process users in chronological order using database transaction
    const usersToPlace = [...activeUsers, ...inactiveUsers];
    let placedUsers = 0;
    let rootUsers = 0;

    console.log("🏗️ Placing users in chronological order...\n");

    if (!dryRun) {
      // Use transaction for atomicity
      await db.transaction(async (trx) => {
        // Clear existing genealogy placements
        console.log("🧹 Clearing existing genealogy placements...");
        await trx("genealogy").del();
        console.log("✅ Existing placements cleared");

        for (let i = 0; i < usersToPlace.length; i++) {
          const user = usersToPlace[i];
          const isActive = user.is_active;

          console.log(
            `   [${i + 1}/${usersToPlace.length}] Processing ${user.name} (${
              user.email
            }) - ${isActive ? "Active" : "Inactive"}`
          );

          // Find sponsor from existing genealogy data
          let sponsorUser = null;
          const sponsorId = sponsorMap.get(user.id);

          if (sponsorId) {
            // Find the sponsor user by ID
            sponsorUser = await trx("users")
              .where("id", sponsorId)
              .select("id", "name", "email")
              .first();

            if (sponsorUser) {
              console.log(
                `     📍 Sponsor found: ${sponsorUser.name} (${sponsorUser.email})`
              );
            } else {
              console.log(
                `     ⚠️  Sponsor user ${sponsorId} not found in users table`
              );
            }
          } else {
            console.log(
              `     ⚠️  No sponsor relationship found for user ${user.id}`
            );
          }

          let position = null;
          let parentId = null;

          if (sponsorUser) {
            // Find the next available position under the sponsor (prioritizing sponsor's positions)
            // This follows the same logic as registration
            try {
              // We need to query within the transaction context
              const sponsorPositionData =
                await getNextAvailablePositionUnderSponsorInTransaction(
                  trx,
                  sponsorUser.id
                );
              position = sponsorPositionData.position;
              parentId = sponsorPositionData.parentId;

              console.log(
                `     🎯 Placement: parent_id=${parentId}, position=${position}`
              );
            } catch (error) {
              console.error(
                `     ❌ Error finding position for user ${user.id}:`,
                error.message
              );
              // If we can't find a position, create as root user
              position = null;
              parentId = null;
              console.log(`     🔄 Falling back to root placement`);
            }
          } else {
            // No sponsor - create as root user
            position = null;
            parentId = null;
            rootUsers++;
            console.log(`     🌱 Root user placement`);
          }

          // Create genealogy record
          const genealogyData = {
            user_id: user.id,
            parent_id: parentId,
            sponsor_id: sponsorUser ? sponsorUser.id : null, // null for root users with no sponsor
            position: position,
            created_at: user.created_at, // Use user's actual creation timestamp
            updated_at: trx.fn.now(), // Set updated_at to now
          };

          await trx("genealogy").insert(genealogyData);
          placedUsers++;

          // Progress update every 50 users
          if ((i + 1) % 50 === 0) {
            console.log(
              `   📈 Progress: ${i + 1}/${usersToPlace.length} users processed`
            );
          }
        }
      });
    } else {
      // Dry run - simulate the process without database changes
      for (let i = 0; i < usersToPlace.length; i++) {
        const user = usersToPlace[i];
        const isActive = user.is_active;

        console.log(
          `   [${i + 1}/${usersToPlace.length}] Processing ${user.name} (${
            user.email
          }) - ${isActive ? "Active" : "Inactive"}`
        );

        // Find sponsor from existing genealogy data
        let sponsorUser = null;
        const sponsorId = sponsorMap.get(user.id);

        if (sponsorId) {
          // Find the sponsor user by ID
          sponsorUser = await db("users")
            .where("id", sponsorId)
            .select("id", "name", "email")
            .first();

          if (sponsorUser) {
            console.log(
              `     📍 Sponsor found: ${sponsorUser.name} (${sponsorUser.email})`
            );
          } else {
            console.log(
              `     ⚠️  Sponsor user ${sponsorId} not found in users table`
            );
          }
        } else {
          console.log(
            `     ⚠️  No sponsor relationship found for user ${user.id}`
          );
        }

        if (sponsorUser) {
          console.log(`     🎯 Would place under sponsor: ${sponsorUser.name}`);
        } else {
          rootUsers++;
          console.log(`     🌱 Would place as root user`);
        }

        placedUsers++;

        // Progress update every 50 users
        if ((i + 1) % 50 === 0) {
          console.log(
            `   📈 Progress: ${i + 1}/${usersToPlace.length} users processed`
          );
        }
      }
    }

    console.log(`\n✅ Placement regeneration completed!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total users processed: ${usersToPlace.length}`);
    console.log(`   - Active users: ${activeUsers.length}`);
    console.log(`   - Inactive users: ${inactiveUsers.length}`);
    console.log(`   - Root users: ${rootUsers}`);
    console.log(`   - Users placed: ${placedUsers}`);

    if (dryRun) {
      console.log(
        `\n🧪 This was a dry run - no changes were made to the database`
      );
      console.log(`💡 Run without --dry-run to apply the changes`);
    } else {
      console.log(
        `\n🎯 Genealogy placements have been regenerated successfully!`
      );
      console.log(
        `💻 You may want to run the team volumes rebuild script next:`
      );
      console.log(`   node backend/scripts/rebuild-team-volumes.js`);
    }
  } catch (error) {
    console.error("❌ Regeneration failed:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

// Command line argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const createBackup = args.includes("--backup");
  const restoreFromBackup = args.includes("--restore-from-backup");

  return { dryRun, createBackup, restoreFromBackup };
}

if (require.main === module) {
  const { dryRun, createBackup, restoreFromBackup } = parseArgs();
  regeneratePlacement(dryRun, createBackup, restoreFromBackup);
}

module.exports = regeneratePlacement;
