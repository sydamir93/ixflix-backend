const db = require('../config/database');

class Genealogy {
  // Find genealogy record by user ID
  static async findByUserId(userId) {
    try {
      const genealogy = await db('genealogy')
        .where('user_id', userId)
        .first();

      return genealogy;
    } catch (error) {
      console.error('Error finding genealogy by user ID:', error);
      throw error;
    }
  }

  // Find genealogy records by parent ID
  static async findByParentId(parentId) {
    try {
      const genealogies = await db('genealogy')
        .where('parent_id', parentId)
        .select(
          'id',
          'user_id',
          'parent_id',
          'sponsor_id',
          'position',
          'created_at',
          'updated_at'
        );

      return genealogies;
    } catch (error) {
      console.error('Error finding genealogy by parent ID:', error);
      throw error;
    }
  }

  // Find genealogy records by sponsor ID
  static async findBySponsorId(sponsorId) {
    try {
      const genealogies = await db('genealogy')
        .where('sponsor_id', sponsorId)
        .select(
          'id',
          'user_id',
          'parent_id',
          'sponsor_id',
          'position',
          'created_at',
          'updated_at'
        );

      return genealogies;
    } catch (error) {
      console.error('Error finding genealogy by sponsor ID:', error);
      throw error;
    }
  }

  // Check if a position is available for a parent
  static async isPositionAvailable(parentId, position) {
    try {
      const existing = await db('genealogy')
        .where('parent_id', parentId)
        .where('position', position)
        .first();

      return !existing; // Return true if position is available
    } catch (error) {
      console.error('Error checking position availability:', error);
      throw error;
    }
  }

  // Get next available position for a parent (left by default, right if left is taken)
  static async getNextAvailablePosition(parentId) {
    try {
      // Check if left position is available
      const leftAvailable = await this.isPositionAvailable(parentId, 'left');
      if (leftAvailable) {
        return 'left';
      }

      // Check if right position is available
      const rightAvailable = await this.isPositionAvailable(parentId, 'right');
      if (rightAvailable) {
        return 'right';
      }

      // No positions available
      return null;
    } catch (error) {
      console.error('Error getting next available position:', error);
      throw error;
    }
  }

  // Get next available position under a specific sponsor (prioritizing sponsor's positions)
  static async getNextAvailablePositionUnderSponsor(sponsorId) {
    try {
      // First, check sponsor's direct left/right positions
      const leftAvailable = await this.isPositionAvailable(sponsorId, 'left');
      if (leftAvailable) {
        return { parentId: sponsorId, position: 'left' };
      }

      const rightAvailable = await this.isPositionAvailable(sponsorId, 'right');
      if (rightAvailable) {
        return { parentId: sponsorId, position: 'right' };
      }

      // Both direct positions are filled, alternate between left and right subtrees
      // Count how many users are already placed under this sponsor (excluding the 2 direct children)
      const allDownlines = await this.getDownline(sponsorId);
      const downlineCount = allDownlines.length - 2; // Subtract the 2 direct children

      // Alternate between left and right subtrees
      // Even count (0, 2, 4...) = left subtree, Odd count (1, 3, 5...) = right subtree
      const useLeftSubtree = (downlineCount % 2) === 0;

      if (useLeftSubtree) {
        // Find available position in left subtree using breadth-first search
        return await this.findAvailablePositionBreadthFirst(sponsorId, 'left');
      } else {
        // Find available position in right subtree using breadth-first search
        return await this.findAvailablePositionBreadthFirst(sponsorId, 'right');
      }
    } catch (error) {
      console.error('Error getting next available position under sponsor:', error);
      throw error;
    }
  }

  // Get the depth of a subtree (left or right) under a parent
  static async getSubtreeDepth(parentId, position) {
    try {
      // Find the child in the specified position
      const child = await db('genealogy')
        .where('parent_id', parentId)
        .where('position', position)
        .join('users', 'genealogy.user_id', 'users.id')
        .select('genealogy.user_id as id')
        .where('users.is_verified', true)
        .first();

      if (!child) {
        return 0; // No child in this position
      }

      // Recursively calculate depth
      return 1 + Math.max(
        await this.getSubtreeDepth(child.id, 'left'),
        await this.getSubtreeDepth(child.id, 'right')
      );
    } catch (error) {
      console.error('Error getting subtree depth:', error);
      throw error;
    }
  }

  // Find available position in a specific subtree following the spine
  // Left subtree always uses left positions, right subtree always uses right positions
  static async findAvailablePositionBreadthFirst(sponsorId, subtreePosition) {
    try {
      // Get the root of the subtree (sponsor's child in the specified position)
      const subtreeRoot = await db('genealogy')
        .where('parent_id', sponsorId)
        .where('position', subtreePosition)
        .join('users', 'genealogy.user_id', 'users.id')
        .select('genealogy.user_id as id')
        .where('users.is_verified', true)
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
        const available = await this.isPositionAvailable(currentNodeId, positionToCheck);
        
        if (available) {
          return { parentId: currentNodeId, position: positionToCheck };
        }

        // Position is taken, find the child in that position and continue down the spine
        const child = await db('genealogy')
          .where('parent_id', currentNodeId)
          .where('position', positionToCheck)
          .join('users', 'genealogy.user_id', 'users.id')
          .select('genealogy.user_id as id')
          .where('users.is_verified', true)
          .first();

        if (!child) {
          // This shouldn't happen if position is not available, but handle it
          return { parentId: currentNodeId, position: positionToCheck };
        }

        currentNodeId = child.id;
      }
    } catch (error) {
      console.error('Error finding available position breadth-first:', error);
      throw error;
    }
  }

  // Find available position in a specific subtree (recursive) - kept for backward compatibility
  static async findAvailablePositionInSubtree(parentId, position) {
    try {
      // Find the child in the specified position
      const child = await db('genealogy')
        .where('parent_id', parentId)
        .where('position', position)
        .join('users', 'genealogy.user_id', 'users.id')
        .select('genealogy.user_id as id')
        .where('users.is_verified', true)
        .first();

      if (!child) {
        // This position is available (shouldn't happen if we're in this function)
        return { parentId: parentId, position: position };
      }

      // Check if this child has available positions
      const leftAvailable = await this.isPositionAvailable(child.id, 'left');
      if (leftAvailable) {
        return { parentId: child.id, position: 'left' };
      }

      const rightAvailable = await this.isPositionAvailable(child.id, 'right');
      if (rightAvailable) {
        return { parentId: child.id, position: 'right' };
      }

      // Both positions taken, go deeper
      const leftSubtreeDepth = await this.getSubtreeDepth(child.id, 'left');
      const rightSubtreeDepth = await this.getSubtreeDepth(child.id, 'right');

      if (leftSubtreeDepth <= rightSubtreeDepth) {
        return await this.findAvailablePositionInSubtree(child.id, 'left');
      } else {
        return await this.findAvailablePositionInSubtree(child.id, 'right');
      }
    } catch (error) {
      console.error('Error finding available position in subtree:', error);
      throw error;
    }
  }

  // Get next available position in the entire tree (fallback)
  static async getNextAvailablePositionInTree() {
    try {
      // Check if genealogy table has any records
      const genealogyCount = await db('genealogy').count('id as count').first();
      if (parseInt(genealogyCount.count) === 0) {
        // No genealogy records exist - this will be the first user (root)
        return { parentId: null, position: null };
      }

      // Find root users (users with no parent)
      const rootUsers = await db('genealogy')
        .whereNull('parent_id')
        .join('users', 'genealogy.user_id', 'users.id')
        .select('genealogy.user_id as id', 'users.name')
        .where('users.is_verified', true);

      // If no root users, this shouldn't happen but handle gracefully
      if (rootUsers.length === 0) {
        return { parentId: null, position: null };
      }

      // Breadth-first search to find the outermost available position
      const queue = rootUsers.map(user => ({ id: user.id, level: 0 }));

      while (queue.length > 0) {
        const currentUser = queue.shift();

        // Check if left position is available
        const leftAvailable = await this.isPositionAvailable(currentUser.id, 'left');
        if (leftAvailable) {
          return { parentId: currentUser.id, position: 'left' };
        }

        // Check if right position is available
        const rightAvailable = await this.isPositionAvailable(currentUser.id, 'right');
        if (rightAvailable) {
          return { parentId: currentUser.id, position: 'right' };
        }

        // Add children to queue for next level traversal
        const children = await db('genealogy')
          .where('parent_id', currentUser.id)
          .join('users', 'genealogy.user_id', 'users.id')
          .select('genealogy.user_id as id', 'users.name')
          .where('users.is_verified', true);

        for (const child of children) {
          queue.push({ id: child.id, level: currentUser.level + 1 });
        }
      }

      // If we reach here, it means we've traversed the entire tree and found no available positions
      // This should theoretically never happen in a proper binary tree, but as a safeguard,
      // we'll create a new root user to ensure registration can always proceed
      return { parentId: null, position: null };
    } catch (error) {
      console.error('Error getting next available position in tree:', error);
      throw error;
    }
  }

  // Create a new genealogy record
  static async create(genealogyData) {
    try {
      const insertResult = await db('genealogy').insert({
        ...genealogyData,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      const genealogyId = Array.isArray(insertResult) ? insertResult[0] : insertResult;
      return genealogyId;
    } catch (error) {
      console.error('Error creating genealogy record:', error);
      throw error;
    }
  }

  // Get user's downline (all descendants)
  static async getDownline(userId, level = null) {
    try {
      // This is a recursive query to get all descendants
      // For simplicity, we'll implement a basic version
      // In a real application, you might want to use a recursive CTE or cache this data

      const downline = [];
      const queue = [{ id: userId, level: 0 }];

      while (queue.length > 0) {
        const current = queue.shift();

        if (level !== null && current.level >= level) {
          continue;
        }

        const children = await db('genealogy')
          .where('parent_id', current.id)
          .join('users', 'genealogy.user_id', 'users.id')
          .select(
            'genealogy.*',
            'users.email',
            'users.name',
            'users.created_at as user_created_at'
          );

        for (const child of children) {
          downline.push({
            ...child,
            level: current.level + 1
          });

          if (level === null || current.level + 1 < level) {
            queue.push({ id: child.user_id, level: current.level + 1 });
          }
        }
      }

      return downline;
    } catch (error) {
      console.error('Error getting downline:', error);
      throw error;
    }
  }

  // Get user's upline (ancestors)
  static async getUpline(userId, levels = null) {
    try {
      const upline = [];
      let currentUserId = userId;
      let currentLevel = 0;

      while (currentUserId && (levels === null || currentLevel < levels)) {
        const genealogy = await db('genealogy')
          .where('user_id', currentUserId)
          .join('users', 'genealogy.parent_id', 'users.id')
          .select(
            'genealogy.*',
            'users.email as parent_email',
            'users.name as parent_name'
          )
          .first();

        if (!genealogy) break;

        upline.push({
          ...genealogy,
          level: currentLevel
        });

        currentUserId = genealogy.parent_id;
        currentLevel++;
      }

      return upline;
    } catch (error) {
      console.error('Error getting upline:', error);
      throw error;
    }
  }

  // Get user's level in the tree
  static async getUserLevel(userId) {
    try {
      const upline = await this.getUpline(userId);
      return upline.length;
    } catch (error) {
      console.error('Error getting user level:', error);
      throw error;
    }
  }

  // Update genealogy record
  static async update(id, updateData) {
    try {
      updateData.updated_at = db.fn.now();

      await db('genealogy')
        .where('id', id)
        .update(updateData);

      return await db('genealogy').where('id', id).first();
    } catch (error) {
      console.error('Error updating genealogy record:', error);
      throw error;
    }
  }

  // Delete genealogy record
  static async delete(id) {
    try {
      await db('genealogy').where('id', id).del();
      return true;
    } catch (error) {
      console.error('Error deleting genealogy record:', error);
      throw error;
    }
  }

  // Get tree statistics for a user
  static async getTreeStats(userId) {
    try {
      const downline = await this.getDownline(userId);

      const stats = {
        total_downline: downline.length,
        left_count: 0,
        right_count: 0,
        levels: {}
      };

      for (const member of downline) {
        // Count by position
        if (member.position === 'left') {
          stats.left_count++;
        } else if (member.position === 'right') {
          stats.right_count++;
        }

        // Count by level
        const level = member.level;
        stats.levels[level] = (stats.levels[level] || 0) + 1;
      }

      return stats;
    } catch (error) {
      console.error('Error getting tree stats:', error);
      throw error;
    }
  }
}

module.exports = Genealogy;
