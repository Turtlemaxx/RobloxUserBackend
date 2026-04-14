const axios = require("axios");

const TIMEOUT = 20000;

class RobloxLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobloxLookupError";
  }
}

function isoToDaysOld(isoStr) {
  if (!isoStr) return null;
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

class RobloxClient {
  constructor() {
    this.http = axios.create({
      timeout: TIMEOUT,
      headers: {
        "User-Agent": "roblox-lookup-api/1.0",
        "Accept": "application/json"
      }
    });
  }

  async get(url, params = undefined) {
    try {
      const res = await this.http.get(url, { params });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const body = JSON.stringify(err.response?.data || {}).slice(0, 300);
      throw new RobloxLookupError(
        `GET ${url} failed${status ? ` with ${status}` : ""}: ${body || err.message}`
      );
    }
  }

  async post(url, payload) {
    try {
      const res = await this.http.post(url, payload);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const body = JSON.stringify(err.response?.data || {}).slice(0, 300);
      throw new RobloxLookupError(
        `POST ${url} failed${status ? ` with ${status}` : ""}: ${body || err.message}`
      );
    }
  }

  async usernameToUser(username) {
    const data = await this.post("https://users.roblox.com/v1/usernames/users", {
      usernames: [username],
      excludeBannedUsers: false
    });

    const users = data.data || [];
    if (!users.length) throw new RobloxLookupError(`Username not found: ${username}`);
    return users[0];
  }

  async getUserProfile(userId) {
    return this.get(`https://users.roblox.com/v1/users/${userId}`);
  }

  async getUsernameHistory(userId, limit = 50) {
    const data = await this.get(`https://users.roblox.com/v1/users/${userId}/username-history`, {
      limit,
      sortOrder: "Asc"
    });
    return (data.data || []).map(x => x.name).filter(Boolean);
  }

  async getFriendCount(userId) {
    const data = await this.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
    return Number(data.count || 0);
  }

  async getFollowerCount(userId) {
    const data = await this.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
    return Number(data.count || 0);
  }

  async getFollowingCount(userId) {
    const data = await this.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
    return Number(data.count || 0);
  }

  async getFriends(userId) {
    const data = await this.get(`https://friends.roblox.com/v1/users/${userId}/friends`);
    return data.data || [];
  }

  async getGroups(userId) {
    const data = await this.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    return (data.data || []).map(entry => ({
      groupId: entry.group?.id ?? null,
      groupName: entry.group?.name ?? null,
      groupOwner: entry.group?.owner?.username ?? null,
      memberCount: entry.group?.memberCount ?? null,
      roleId: entry.role?.id ?? null,
      roleName: entry.role?.name ?? null,
      roleRank: entry.role?.rank ?? null
    }));
  }

  async getBadges(userId, limit = 100) {
    const data = await this.get(`https://badges.roblox.com/v1/users/${userId}/badges`, {
      limit,
      sortOrder: "Asc"
    });

    return (data.data || []).map(badge => ({
      id: badge.id ?? null,
      name: badge.name ?? null,
      description: badge.description ?? null,
      awarder: badge.awarder?.name ?? null
    }));
  }

  async getAvatarHeadshot(userId, size = "420x420") {
    const data = await this.get("https://thumbnails.roblox.com/v1/users/avatar-headshot", {
      userIds: userId,
      size,
      format: "Png",
      isCircular: false
    });

    const items = data.data || [];
    return items.length ? items[0].imageUrl || null : null;
  }

  async getCurrentlyWearing(userId) {
    return this.get(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`);
  }

  async getCollectibles(userId, limit = 100) {
    const data = await this.get(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles`, {
      limit,
      sortOrder: "Asc"
    });

    return (data.data || []).map(item => ({
      assetId: item.assetId ?? null,
      name: item.name ?? null,
      serialNumber: item.serialNumber ?? null,
      assetStock: item.assetStock ?? null,
      recentAveragePrice: item.recentAveragePrice ?? null,
      originalPrice: item.originalPrice ?? null,
      buildersClubMembershipType: item.buildersClubMembershipType ?? null
    }));
  }

  async lookup(username) {
    const found = await this.usernameToUser(username);
    const userId = Number(found.id);

    const [
      profile,
      usernameHistory,
      friendCount,
      followerCount,
      followingCount,
      headshotUrl,
      currentlyWearing,
      groups,
      badges,
      collectibles
    ] = await Promise.all([
      this.getUserProfile(userId),
      this.getUsernameHistory(userId),
      this.getFriendCount(userId),
      this.getFollowerCount(userId),
      this.getFollowingCount(userId),
      this.getAvatarHeadshot(userId),
      this.getCurrentlyWearing(userId),
      this.getGroups(userId),
      this.getBadges(userId),
      this.getCollectibles(userId)
    ]);

    const created = profile.created ?? null;

    return {
      inputUsername: username,
      resolvedUser: {
        id: userId,
        name: profile.name ?? null,
        displayName: profile.displayName ?? null,
        description: profile.description ?? null,
        isBanned: profile.isBanned ?? null,
        created,
        accountAgeDays: isoToDaysOld(created),
        hasVerifiedBadge: profile.hasVerifiedBadge ?? null
      },
      usernameHistory,
      socialCounts: {
        friends: friendCount,
        followers: followerCount,
        following: followingCount
      },
      avatar: {
        headshotUrl,
        currentlyWearingAssetIds: currentlyWearing.assetIds || [],
        avatarType: currentlyWearing.avatarType ?? null,
        scales: currentlyWearing.scales ?? null,
        bodyColors: currentlyWearing.bodyColors ?? null
      },
      groups,
      badges,
      collectibles
    };
  }
}

function mutualFriendIds(aFriends, bFriends) {
  const aIds = new Set(aFriends.map(x => Number(x.id)).filter(Number.isFinite));
  return bFriends
    .map(x => Number(x.id))
    .filter(id => Number.isFinite(id) && aIds.has(id))
    .sort((a, b) => a - b);
}

function mutualGroups(aGroups, bGroups) {
  const bMap = new Map(
    bGroups.filter(g => g.groupId != null).map(g => [Number(g.groupId), g])
  );

  const out = [];
  for (const g of aGroups) {
    if (g.groupId == null) continue;
    const gid = Number(g.groupId);
    if (bMap.has(gid)) {
      out.push({
        groupId: gid,
        groupName: g.groupName,
        userARole: g.roleName,
        userBRole: bMap.get(gid).roleName
      });
    }
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const username = String(req.query.username || "").trim();
  const compare = String(req.query.compare || "").trim();

  if (!username) {
    res.status(400).json({ error: "Missing username query param." });
    return;
  }

  try {
    const client = new RobloxClient();
    const result = await client.lookup(username);

    if (compare) {
      const compareResult = await client.lookup(compare);

      const [aFriends, bFriends] = await Promise.all([
        client.getFriends(result.resolvedUser.id),
        client.getFriends(compareResult.resolvedUser.id)
      ]);

      result.compare = {
        against: compareResult.resolvedUser,
        mutualFriendIds: mutualFriendIds(aFriends, bFriends),
        mutualGroups: mutualGroups(result.groups, compareResult.groups)
      };
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
