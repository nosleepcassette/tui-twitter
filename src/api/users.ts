import type { XApiClient } from "./client.js";
import { DEFAULT_USER_FIELDS } from "./fields.js";
import type { XApiObjectResponse, XUser } from "../types.js";

export async function getAuthenticatedUser(client: XApiClient): Promise<XUser> {
  const response = await client.get<XApiObjectResponse<XUser>>("users/me", {
    "user.fields": DEFAULT_USER_FIELDS,
  });
  return response.data.data;
}

export async function getUserByUsername(client: XApiClient, username: string): Promise<XUser> {
  const response = await client.get<XApiObjectResponse<XUser>>(`users/by/username/${username}`, {
    "user.fields": DEFAULT_USER_FIELDS,
  });
  return response.data.data;
}
