export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === "invitation.mortalive.com") {

    // Clean URL: /invitation → /
    if (url.pathname === "/invitation") {
      return Response.redirect(
        "https://invitation.mortalive.com/",
        301
      );
    }

    // Root of invitation subdomain → invitation.html
    if (url.pathname === "/") {
      const invitationUrl = new URL("/invitation.html", url);

      return context.env.ASSETS.fetch(
        new Request(invitationUrl, context.request)
      );
    }
  }

  return context.next();
}
