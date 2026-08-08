// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";


export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    emailOtp,
    Anonymous,
    // Kullanıcı adı + şifre ile giriş. The username is stored as the
    // provider's `email` identifier. Password requirements are relaxed so
    // short passwords (e.g. the seeded Admin / 8842) are allowed.
    Password({
      validatePasswordRequirements: () => {
        // v1 uses short, manager-chosen passwords
      },
    }),
  ],
});