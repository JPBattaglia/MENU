const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {

  if (event.httpMethod !== "POST") {
    return { statusCode: 405 };
  }

  const data = JSON.parse(event.body);

  try {

    const session = await stripe.checkout.sessions.create({

      mode: "payment",

      line_items: data.items.map(item => ({
        price: item.priceId,
        quantity: item.quantity
      })),

      success_url: process.env.URL + "/checkoutsuccess.html",
      cancel_url: process.env.URL + "/checkoutcancel.html"

    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };

  } catch (error) {

    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };

  }

};
