export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (
    url.hostname === "invitation.mortalive.com" &&
    url.pathname === "/"
  ) {
    const assetUrl = new URL(url);
    assetUrl.pathname = "/invitation.html";

    const response = await context.env.ASSETS.fetch(
      new Request(assetUrl, context.request)
    );

    return new Response(response.body, response);
  }

  return context.next();
}
