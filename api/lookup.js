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

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
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
    if (!users.length) {
      throw new RobloxLookupError(`Username not found: ${username}`);
    }

    return users[0];
  }

  async getUserProfile(userId) {
    return this.get(`https://users.roblox.com/v1/users/${userId}`);
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

  async getBadges(userId, limit = 8) {
    const data = await this.get(`https://badges.roblox.com/v1/users/${userId}/badges`, {
      limit,
      sortOrder: "Desc"
    });

    const badges = data.data || [];
    if (!badges.length) return [];

    const badgeIds = badges.map(b => b.id).filter(Boolean);

    let iconMap = new Map();

    try {
      const thumbData = await this.get("https://thumbnails.roblox.com/v1/badges/icons", {
        badgeIds: badgeIds.join(","),
        size: "150x150",
        format: "Png"
      });

      iconMap = new Map(
        (thumbData.data || []).map(x => [x.targetId, x.imageUrl || null])
      );
    } catch {
      iconMap = new Map();
    }

    return badges.map(badge => ({
      id: badge.id ?? null,
      name: badge.name ?? null,
      description: badge.description ?? null,
      awarder: badge.awarder?.name ?? null,
      iconUrl: iconMap.get(badge.id) || null
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

  async getWearingItems(userId) {
    const wearing = await this.getCurrentlyWearing(userId);
  
    return {
      assetIds: wearing.assetIds || []
    };
  }

  async getAssetDetails(assetIds) {
    if (!Array.isArray(assetIds) || !assetIds.length) return [];
  
    const ids = assetIds
      .map(id => Number(id))
      .filter(Number.isFinite)
      .slice(0, 50);
  
    if (!ids.length) return [];
  
    const data = await this.post("https://catalog.roblox.com/v1/catalog/items/details", {
      items: ids.map(id => ({
        itemType: "Asset",
        id
      }))
    });
  
    return (data.data || []).map(item => ({
      id: item.id ?? null,
      name: item.name ?? null,
      creatorName: item.creatorName ?? null,
      price: item.lowestPrice ?? null
    }));
  }

  async getAssetThumbnails(assetIds) {
    if (!Array.isArray(assetIds) || !assetIds.length) return new Map();

    const ids = assetIds
      .map(id => Number(id))
      .filter(Number.isFinite)
      .slice(0, 50);

    if (!ids.length) return new Map();

    const data = await this.get("https://thumbnails.roblox.com/v1/assets", {
      assetIds: ids.join(","),
      size: "250x250",
      format: "Png",
      returnPolicy: "PlaceHolder"
    });

    return new Map(
      (data.data || []).map(item => [item.targetId, item.imageUrl || null])
    );
  }

  async getWearingItems(userId) {
    const wearing = await this.getCurrentlyWearing(userId);
    const assetIds = wearing.assetIds || [];
  
    if (!assetIds.length) {
      return {
        avatarType: wearing.avatarType ?? null,
        scales: wearing.scales ?? null,
        bodyColors: wearing.bodyColors ?? null,
        assetIds: [],
        items: []
      };
    }
  
    const [details, thumbMap] = await Promise.all([
      safeCall(() => this.getAssetDetails(assetIds), []),
      safeCall(() => this.getAssetThumbnails(assetIds), new Map())
    ]);
  
    const detailMap = new Map(details.map(item => [item.id, item]));
  
    const items = assetIds.map(id => {
      const numericId = Number(id);
      const detail = detailMap.get(numericId) || {};
  
      return {
        name: detail.name ?? null,
        creatorName: detail.creatorName ?? null,
        price: detail.price ?? null,
        itemUrl: `https://www.roblox.com/catalog/${numericId}`,
        thumbnailUrl: thumbMap.get(numericId) || null
      };
    });
  
    return {
      avatarType: wearing.avatarType ?? null,
      scales: wearing.scales ?? null,
      bodyColors: wearing.bodyColors ?? null,
      assetIds,
      items
    };
  }

  async lookup(username) {
    const found = await this.usernameToUser(username);
    const userId = Number(found.id);

    const profile = await this.getUserProfile(userId);
    const created = profile.created ?? null;

    const [
      friendCount,
      followerCount,
      followingCount,
      headshotUrl,
      groups,
      badges,
      wearing
    ] = await Promise.all([
      safeCall(() => this.getFriendCount(userId), 0),
      safeCall(() => this.getFollowerCount(userId), 0),
      safeCall(() => this.getFollowingCount(userId), 0),
      safeCall(() => this.getAvatarHeadshot(userId), null),
      safeCall(() => this.getGroups(userId), []),
      safeCall(() => this.getBadges(userId, 8), []),
      safeCall(() => this.getWearingItems(userId), {
        avatarType: null,
        scales: null,
        bodyColors: null,
        assetIds: [],
        items: []
      })
    ]);

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
      socialCounts: {
        friends: friendCount,
        followers: followerCount,
        following: followingCount
      },
      avatar: {
        headshotUrl,
        avatarType: wearing.avatarType,
        scales: wearing.scales,
        bodyColors: wearing.bodyColors
      },
      wearing: {
        assetIds: wearing.assetIds,
        items: wearing.items
      },
      groups,
      badges
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
        safeCall(() => client.getFriends(result.resolvedUser.id), []),
        safeCall(() => client.getFriends(compareResult.resolvedUser.id), [])
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
