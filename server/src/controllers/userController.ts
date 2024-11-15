import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const verifyStripeSession = async (sessionId: string): Promise<Stripe.Checkout.Session | null> => {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session;
  } catch (error) {
    console.error('Stripe session retrieval failed:', error);
    return null;
  }
};

// Ensure the environment variable is set
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}


export const updateAfterPayment = async (req: Request, res: Response) => {
  const { sessionId, firstName, lastName, profilePictureUrl } = req.body;

  if (!sessionId || !firstName || !lastName) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }

  try {
    // Verify the sessionId with Stripe
    const session = await verifyStripeSession(sessionId);
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ success: false, error: 'Invalid or unpaid session ID.' });
    }

    // Extract user information from the session, e.g., Cognito ID
    // Assuming you stored Cognito ID in metadata or client_reference_id during Stripe checkout
    const cognitoId = session.client_reference_id;

    if (!cognitoId) {
      return res.status(400).json({ success: false, error: 'Cognito ID not found in session.' });
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { cognitoId: cognitoId },
    });

    if (user) {
      // Update existing user
      user = await prisma.user.update({
        where: { cognitoId: cognitoId },
        data: {
          firstName,
          lastName,
          profilePictureUrl,
          subscriptionStatus: 'active',
        },
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          cognitoId,
          firstName,
          lastName,
          profilePictureUrl,
          subscriptionStatus: 'active',
          // You might need to set other required fields like username and email
          // These should be passed from the frontend or extracted from Cognito
          username: `user_${cognitoId}`, // Example username generation
          email: `${cognitoId}@example.com`, // Replace with actual email extraction
        },
      });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
};

export const checkSubscriptionStatus = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    // Retrieve the customer based on email
    const customers = await stripe.customers.list({ email });
    if (customers.data.length === 0) {
      return res.json({ hasSubscription: false });
    }

    const customerId = customers.data[0].id;

    // Retrieve subscriptions for the customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
    });

    const hasSubscription = subscriptions.data.length > 0;
    return res.json({ hasSubscription });
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return res.status(500).json({ error: 'Failed to check subscription status' });
  }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `Error retrieving users: ${error.message}` });
  }
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  const { cognitoId } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: {
        cognitoId: cognitoId,
      },
    });

    res.json(user);
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `Error retrieving user: ${error.message}` });
  }
};

// export const postUser = async (req: Request, res: Response) => {
//   try {
//     const {
//       username,
//       cognitoId,
//       email,
//       profilePictureUrl = "i1.jpg",
//       teamId = 1,
//     } = req.body;
//     const newUser = await prisma.user.create({
//       data: {
//         username,
//         cognitoId,
//         email,
//         profilePictureUrl,
//         teamId,
//       },
//     });
//     res.json({ message: "User Created Successfully", newUser });
//   } catch (error: any) {
//     res
//       .status(500)
//       .json({ message: `Error retrieving users: ${error.message}` });
//   }
// };

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'] as string;

  try {
    const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerEmail = session.customer_details?.email;

      if (customerEmail) {
        // Update the subscription status of the user
        await prisma.user.update({
          where: { email: customerEmail },
          data: { subscriptionStatus: 'active' },
        });
        console.log("User subscription status updated to active.");
      }
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
};



export const fetchSessionData = async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const cognitoId = session.client_reference_id;

    if (!cognitoId) {
      return res.status(400).json({ error: 'Cognito ID not found in session.' });
    }

    res.status(200).json({ cognitoId });
  } catch (error) {
    console.error('Error fetching session data:', error);
    res.status(500).json({ error: 'Failed to fetch session data.' });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { cognitoId, status } = req.body;

    if (!cognitoId || !status) {
      return res.status(400).json({ message: 'Missing cognitoId or status' });
    }

    // Update the user's status in the database
    const updatedUser = await prisma.user.update({
      where: { cognitoId: cognitoId },
      data: { subscriptionStatus: status },
    });

    return res.status(200).json({ message: 'User status updated successfully', user: updatedUser });
  } catch (error: any) {
    console.error('Error updating user status:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

// export const createUser = async (req: Request, res: Response) => {
//   const { cognitoId, username, email } = req.body;

//   try {
//     // Use Prisma to insert the user into the database
//     const newUser = await prisma.user.create({
//       data: {
//         cognitoId,
//         username,
//         email,
//       },
//     });

//     // Send back success response
//     res.status(201).json({
//       message: 'User created successfully.',
//       user: newUser,
//     });
//   } catch (error: any) {
//     console.error('Error creating user:', error);
//     res.status(500).json({
//       message: 'An error occurred while creating the user in the database.',
//       error: error.message,
//     });
//   }
// };


export const updateUserAfterPayment = async (req: Request, res: Response) => {
  const { sessionId, firstName, lastName, profilePictureUrl, username } = req.body;

  if (!sessionId || !firstName || !lastName || !username) {
    return res.status(400).json({ error: 'Session ID, first name, last name, and username are required.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerEmail = session.customer_details?.email;

    if (!customerEmail) {
      return res.status(400).json({ error: 'Customer email not found in session.' });
    }

    let user = await prisma.user.findUnique({ where: { email: customerEmail } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: customerEmail,
          firstName,
          lastName,
          profilePictureUrl,
          subscriptionStatus: 'active',
          username,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { email: customerEmail },
        data: {
          firstName,
          lastName,
          profilePictureUrl,
          subscriptionStatus: 'active',
        },
      });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Error updating user after payment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const checkUserStatus = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { subscriptionStatus: true },
    });

    if (user) {
      return res.status(200).json({ subscriptionStatus: user.subscriptionStatus });
    } else {
      return res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};