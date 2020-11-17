import {FastifyReply, FastifyRequest, RouteShorthandOptions} from "fastify";
import jwt, {VerifyErrors} from "jsonwebtoken";
import {appConfig} from "../config/app-config";
import {Pool} from "pg";
import {ReplyUtils} from "./reply-utils";
import {constants as HttpStatus} from "http2";

/**
 * A Fastify request that has been properly authenticated via a JWT token.
 * It contains extra data provided by the token itself.
 */
export interface AuthenticatedRequest extends FastifyRequest {
  /**
   * The authenticated request user account.
   */
  user: User;

  /**
   * The authenticated request active profile.
   */
  profile: Profile;
}

export class Auth {

  /**
   * Default authentication options for controllers.
   */
  static AuthedRouteOpts: RouteShorthandOptions = {
    preHandler: Auth.checkAuth
  };

  /**
   * Private pool instance for Auth.
   * @private
   */
  private static pool: Pool;

  /**
   * Initialize Auth.
   * @param pool
   */
  static initialize(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Checks for authentication before allowing a request to pass through.
   *
   * @param request
   * @param reply
   * @param done
   */
  static checkAuth(request: FastifyRequest, reply: FastifyReply, done: Function) {
    let token: string | null | undefined = (<any>request.body).token;

    if ((<any>request.query).token) {
      token = (<any>request.query).token;
    }

    if (!token)
      return reply.status(HttpStatus.HTTP_STATUS_BAD_REQUEST).send(ReplyUtils.error("Token was missing."));

    jwt.verify(
      token,
      appConfig.secret,
      async function (err: VerifyErrors | null, decoded: any | undefined) {
        if (err)
          return reply.status(HttpStatus.HTTP_STATUS_BAD_REQUEST).send(ReplyUtils.error("Error while validating token.", err));

        if (!decoded.email)
          return reply.status(HttpStatus.HTTP_STATUS_BAD_REQUEST).send(ReplyUtils.error("Unable to verify user, invalid token."));

        try {

          // First, we need to grab the user account from the token.

          let accountQuery = await Auth.pool.query(
            "select * from app.users where email=$1",
            [
              decoded.email
            ]
          );

          if (accountQuery.rowCount > 0) {
            let user = accountQuery.rows[0];

            // Next, we grab the active profile

            let profileQuery = await Auth.pool.query(
              "select * from app.profiles where handle=$1",
              [
                user.active_profile
              ]
            );

            if (profileQuery.rowCount > 0) {
              let profile = profileQuery.rows[0];

              // Finally, after we've found all the data we need, we attach it to the request.

              let authRequest = <AuthenticatedRequest>request;

              authRequest.user = {
                activeProfile: user.active_profile,
                createdOn: user.created_on,
                email: user.email,
                fullName: user.full_name,
                inventory: user.inventory,
                metadata: user.metadata,
                subscriptionTier: user.subscription_tier,
                id: user.id
              };

              authRequest.profile = {
                createdOn: profile.created_on,
                customCss: profile.custom_css,
                customHtml: profile.custom_html,
                customDomain: profile.custom_domain,
                handle: profile.handle,
                headline: profile.headline,
                imageUrl: profile.image_url,
                metadata: profile.metadata,
                userId: profile.user_id,
                id: profile.id,
                social: {
                  alt: profile.social?.alt,
                  icon: profile.social?.icon,
                  link: profile.social?.link
                },
                themeId: profile.theme,
                visibility: profile.visibility
              };


            }

            done();
            return;

          } else {
            return reply.status(HttpStatus.HTTP_STATUS_NOT_FOUND).send(ReplyUtils.error("Unable to find account with this token."));
          }

        } catch (err) {

          if (err)
            return reply.status(HttpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR).send(ReplyUtils.error("Error while authenticating request.", err));

        }

        return reply.status(HttpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR).send(ReplyUtils.error("An unexpected error occurred."));
      });
  }

}