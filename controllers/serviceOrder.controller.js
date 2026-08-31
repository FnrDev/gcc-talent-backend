const crypto = require("node:crypto");
const mongoose = require("mongoose");

const AuditLog = require("../models/AuditLog");
const Contract = require("../models/Contract");
const Package = require("../models/Package");
const Service = require("../models/Service");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { recordAuditLogs } = require("../services/audit.service");

const DECLINED_TEST_CARD = "4000000000000002";
const PAYMENT_MODE = "mock";

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 1000) / 1000;
}

function mockCheckoutEnabled() {
  const configured = process.env.MOCK_SERVICE_CHECKOUT_ENABLED;
  if (configured !== undefined) return configured === "true";
  return process.env.NODE_ENV !== "production";
}

function parseIdempotencyKey(req) {
  const value = req.get("Idempotency-Key");
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{8,200}$/.test(trimmed) ? trimmed : null;
}

function passesLuhn(cardNumber) {
  let sum = 0;
  let doubleDigit = false;

  for (let index = cardNumber.length - 1; index >= 0; index -= 1) {
    let digit = Number(cardNumber[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function validateMockPayment(rawPayment) {
  if (!rawPayment || typeof rawPayment !== "object" || Array.isArray(rawPayment)) {
    return { error: "Mock payment details are required." };
  }

  const cardholderName = typeof rawPayment.cardholderName === "string"
    ? rawPayment.cardholderName.replace(/\s+/g, " ").trim()
    : "";
  const cardNumber = typeof rawPayment.cardNumber === "string"
    ? rawPayment.cardNumber.replace(/[\s-]/g, "")
    : "";
  const expiry = typeof rawPayment.expiry === "string" ? rawPayment.expiry.trim() : "";
  const cvc = typeof rawPayment.cvc === "string" ? rawPayment.cvc.trim() : "";

  if (
    cardholderName.length < 2 ||
    cardholderName.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(cardholderName)
  ) {
    return { error: "Enter a valid cardholder name." };
  }
  if (!/^\d{13,19}$/.test(cardNumber) || !passesLuhn(cardNumber)) {
    return { error: "Enter a valid test card number." };
  }

  const expiryMatch = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.exec(expiry);
  if (!expiryMatch) {
    return { error: "Enter the expiry as MM/YY." };
  }

  const expiryMonth = Number(expiryMatch[1]);
  const rawYear = Number(expiryMatch[2]);
  const expiryYear = expiryMatch[2].length === 2 ? 2000 + rawYear : rawYear;
  const firstDayAfterExpiry = new Date(Date.UTC(expiryYear, expiryMonth, 1));
  if (expiryYear < 2000 || firstDayAfterExpiry <= new Date()) {
    return { error: "The test card expiry date has passed." };
  }
  if (!/^\d{3,4}$/.test(cvc)) {
    return { error: "Enter a valid 3 or 4 digit CVC." };
  }

  return {
    payment: {
      cardholderName,
      cardNumber,
      expiry: `${expiryMatch[1]}/${String(expiryYear).slice(-2)}`,
      cvc,
    },
  };
}

function orderReference(clientId, idempotencyKey) {
  const digest = crypto
    .createHash("sha256")
    .update(`${String(clientId)}:${idempotencyKey}`)
    .digest("hex");
  return `service-order:${String(clientId)}:${digest}`;
}

function orderRequestHash(serviceId, packageId) {
  return crypto
    .createHash("sha256")
    .update(`service:${String(serviceId)}:package:${String(packageId)}`)
    .digest("hex");
}

function matchesOrderRequest(contract, serviceId, packageId, requestHash) {
  return (
    contract.orderRequestHash === requestHash &&
    contract.source?.type === "service" &&
    String(contract.source.service) === String(serviceId) &&
    String(contract.source.package) === String(packageId)
  );
}

function transactionAuditEntry(transaction, operation) {
  return {
    auditId: orderAuditId("transaction", transaction._id),
    action: "create",
    resource: "Transaction",
    resourceId: transaction._id,
    details: {
      operation,
      userId: transaction.user,
      contractId: transaction.contract,
      milestoneId: transaction.milestoneId,
      type: transaction.type,
      amount: transaction.amount,
      direction: transaction.direction,
      status: transaction.status,
      paymentMode: PAYMENT_MODE,
    },
  };
}

function contractAuditEntry(contract) {
  return {
    auditId: orderAuditId("contract", contract._id),
    action: "create",
    resource: "Contract",
    resourceId: contract._id,
    details: {
      operation: "createServiceOrder",
      serviceId: contract.source.service,
      packageId: contract.source.package,
      status: contract.status,
      totalAmount: contract.totalAmount,
      currency: contract.currency,
      paymentMode: PAYMENT_MODE,
    },
  };
}

function orderAuditId(resource, resourceId) {
  const hex = crypto
    .createHash("sha256")
    .update(`service-order-audit:${resource}:${String(resourceId)}`)
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function supportsTransactions() {
  const topologyType = mongoose.connection.getClient()?.topology?.description?.type;
  return topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded";
}

function ledgerSpecifications(contract) {
  const milestone = contract.milestones?.[0];
  if (!milestone) {
    const error = new Error("The service order is missing its funded milestone.");
    error.code = "ORDER_INTEGRITY_ERROR";
    throw error;
  }

  return [
    {
      user: contract.client,
      contract: contract._id,
      type: "deposit",
      amount: contract.totalAmount,
      direction: "credit",
      status: "completed",
      reference: `mock-card-deposit:${contract._id}`,
    },
    {
      user: contract.client,
      contract: contract._id,
      milestoneId: milestone._id,
      type: "escrow_fund",
      amount: contract.totalAmount,
      direction: "debit",
      status: "completed",
      reference: `escrow-fund:${contract._id}:${milestone._id}`,
    },
  ];
}

function sameLedgerEntry(transaction, specification) {
  return (
    String(transaction.user) === String(specification.user) &&
    String(transaction.contract) === String(specification.contract) &&
    String(transaction.milestoneId || "") === String(specification.milestoneId || "") &&
    transaction.type === specification.type &&
    roundMoney(transaction.amount) === roundMoney(specification.amount) &&
    transaction.direction === specification.direction &&
    transaction.status === "completed"
  );
}

async function ensureLedgerEntry(specification) {
  let transaction = await Transaction.findOne({ reference: specification.reference });
  if (transaction) {
    if (!sameLedgerEntry(transaction, specification)) {
      const error = new Error("The service order ledger could not be reconciled.");
      error.code = "ORDER_INTEGRITY_ERROR";
      throw error;
    }
    return { transaction, created: false };
  }

  try {
    transaction = await Transaction.create(specification);
    return { transaction, created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    transaction = await Transaction.findOne({ reference: specification.reference });
    if (!transaction || !sameLedgerEntry(transaction, specification)) {
      const integrityError = new Error("The service order ledger could not be reconciled.");
      integrityError.code = "ORDER_INTEGRITY_ERROR";
      throw integrityError;
    }
    return { transaction, created: false };
  }
}

function sameOrderAudit(audit, entry) {
  return (
    audit?.action === entry.action &&
    audit?.resource === entry.resource &&
    String(audit?.resourceId) === String(entry.resourceId) &&
    audit?.details?.operation === entry.details.operation
  );
}

async function ensureOrderAudit(req, entry) {
  const semanticFilter = {
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    "details.operation": entry.details.operation,
  };
  let audit = await AuditLog.findOne({
    $or: [{ _id: entry.auditId }, semanticFilter],
  }).select("action resource resourceId details");

  if (audit) {
    if (!sameOrderAudit(audit, entry)) {
      const error = new Error("The service order audit trail could not be reconciled.");
      error.code = "ORDER_INTEGRITY_ERROR";
      throw error;
    }
    return audit;
  }

  await recordAuditLogs(req, [entry]);
  audit = await AuditLog.findOne({
    $or: [{ _id: entry.auditId }, semanticFilter],
  }).select("action resource resourceId details");

  if (!audit || !sameOrderAudit(audit, entry)) {
    const error = new Error("The service order audit trail could not be reconciled.");
    error.code = "ORDER_INTEGRITY_ERROR";
    throw error;
  }
  return audit;
}

async function ensureOrderAudits(req, entries) {
  for (const entry of entries) {
    await ensureOrderAudit(req, entry);
  }
}

async function ensureLedger(contract, req) {
  const results = [];
  for (const specification of ledgerSpecifications(contract)) {
    results.push(await ensureLedgerEntry(specification));
  }

  const transactions = results.map((result) => result.transaction);
  await ensureOrderAudits(req, [
    contractAuditEntry(contract),
    ...transactions.map((transaction) => transactionAuditEntry(transaction, "createServiceOrder")),
  ]);

  return transactions;
}

function buildContractData({ client, freelancer, service, packageItem, reference, requestHash }) {
  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setUTCDate(dueDate.getUTCDate() + packageItem.deliveryDays);
  const amount = roundMoney(packageItem.price);

  return {
    client: client._id,
    freelancer: freelancer._id,
    source: {
      type: "service",
      service: service._id,
      package: packageItem._id,
      packageSnapshot: {
        serviceName: service.name,
        packageName: packageItem.name,
        title: packageItem.title,
        description: packageItem.description,
        price: amount,
        currency: packageItem.currency,
        deliveryDays: packageItem.deliveryDays,
        revisions: packageItem.revisions,
        features: packageItem.features,
      },
    },
    title: service.name,
    totalAmount: amount,
    currency: packageItem.currency,
    status: "active",
    orderReference: reference,
    orderRequestHash: requestHash,
    milestones: [{
      title: packageItem.title,
      description: packageItem.description,
      amount,
      dueDate,
      status: "funded",
      escrowAmount: amount,
      fundedAt: now,
    }],
    activity: [{
      type: "contract_created",
      by: client._id,
      message: `Service order created with the ${packageItem.name} package.`,
      at: now,
    }, {
      type: "milestone_funded",
      by: client._id,
      message: `Mock card checkout funded ${amount} ${packageItem.currency}.`,
      at: now,
    }],
    startedAt: now,
  };
}

function buildPendingContractData(contractData) {
  const milestone = { ...contractData.milestones[0], status: "pending", escrowAmount: 0 };
  delete milestone.fundedAt;

  return {
    ...contractData,
    milestones: [milestone],
    activity: contractData.activity.filter((entry) => entry.type !== "milestone_funded"),
  };
}

function hasFundedActivity(contract) {
  return contract.activity?.some((entry) => entry.type === "milestone_funded");
}

async function finalizePendingOrder(contract) {
  const milestone = contract.milestones?.[0];
  if (!milestone || contract.milestones.length !== 1) {
    const error = new Error("The service order milestone could not be reconciled.");
    error.code = "ORDER_INTEGRITY_ERROR";
    throw error;
  }

  if (hasFundedActivity(contract)) {
    if (milestone.status === "pending") {
      const error = new Error("The service order funding state is inconsistent.");
      error.code = "ORDER_INTEGRITY_ERROR";
      throw error;
    }
    return contract;
  }

  if (
    contract.status !== "active" ||
    milestone.status !== "pending" ||
    roundMoney(milestone.escrowAmount || 0) !== 0
  ) {
    const error = new Error("The pending service order can no longer be funded safely.");
    error.code = "ORDER_INTEGRITY_ERROR";
    throw error;
  }

  const amount = roundMoney(contract.totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error("The service order amount is invalid.");
    error.code = "ORDER_INTEGRITY_ERROR";
    throw error;
  }

  const fundedAt = new Date();
  const updated = await Contract.findOneAndUpdate(
    {
      _id: contract._id,
      status: "active",
      milestones: { $size: 1 },
      "milestones.0._id": milestone._id,
      "milestones.0.status": "pending",
      "milestones.0.escrowAmount": 0,
      "activity.type": { $ne: "milestone_funded" },
    },
    {
      $set: {
        "milestones.0.status": "funded",
        "milestones.0.escrowAmount": amount,
        "milestones.0.fundedAt": fundedAt,
      },
      $push: {
        activity: {
          type: "milestone_funded",
          by: contract.client,
          message: `Mock card checkout funded ${amount} ${contract.currency}.`,
          at: fundedAt,
        },
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (updated) return updated;

  const current = await Contract.findById(contract._id)
    .select("+orderReference +orderRequestHash");
  if (current && hasFundedActivity(current) && current.milestones?.[0]?.status !== "pending") {
    return current;
  }

  const error = new Error("The pending service order could not be finalized safely.");
  error.code = "ORDER_INTEGRITY_ERROR";
  throw error;
}

async function reconcileOrder(contract, req) {
  await ensureLedger(contract, req);
  return finalizePendingOrder(contract);
}

async function createOrderRecords(contractData, req) {
  if (!supportsTransactions()) {
    const [contract] = await Contract.create([buildPendingContractData(contractData)]);
    return reconcileOrder(contract, req);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const [contract] = await Contract.create([contractData], { session });
    const transactions = await Transaction.insertMany(ledgerSpecifications(contract), { session, ordered: true });
    await recordAuditLogs(
      req,
      [contractAuditEntry(contract), ...transactions.map((transaction) => (
        transactionAuditEntry(transaction, "createServiceOrder")
      ))],
      { session },
    );
    await session.commitTransaction();
    return contract;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

async function populatedContract(contractId) {
  return Contract.findById(contractId)
    .populate("client", "name avatarUrl country city")
    .populate("freelancer", "name avatarUrl country city ratingAvg ratingCount")
    .populate("source.service", "name images")
    .populate("source.package", "name title deliveryDays revisions");
}

function handleError(res, error) {
  if (error?.code === "ORDER_INTEGRITY_ERROR") {
    return res.status(500).json({
      success: false,
      code: "ORDER_INTEGRITY_ERROR",
      message: "The order could not be confirmed safely. Retry this same checkout.",
    });
  }
  if (error?.name === "ValidationError") {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error?.name === "CastError") {
    return res.status(404).json({ success: false, message: "Service or package not found." });
  }

  console.error("Service order creation failed.", { code: error?.code, name: error?.name });
  return res.status(500).json({ success: false, message: "The order could not be created." });
}

async function createServiceOrder(req, res) {
  try {
    if (!mockCheckoutEnabled()) {
      return res.status(503).json({
        success: false,
        code: "MOCK_CHECKOUT_DISABLED",
        message: "Demo checkout is not enabled in this environment.",
      });
    }

    const client = await User.findById(req.user._id).select("role status");
    if (!client) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (client.role !== "client") {
      return res.status(403).json({ success: false, message: "Only client accounts can order services." });
    }
    if (client.status === "suspended") {
      return res.status(403).json({ success: false, message: "Suspended accounts cannot place orders." });
    }

    const idempotencyKey = parseIdempotencyKey(req);
    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: "A valid Idempotency-Key header is required.",
      });
    }

    const { packageId, payment: rawPayment } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(packageId)) {
      return res.status(400).json({ success: false, message: "A valid package is required." });
    }

    const serviceId = new mongoose.Types.ObjectId(req.params.id).toHexString();
    const normalizedPackageId = new mongoose.Types.ObjectId(packageId).toHexString();
    const reference = orderReference(client._id, idempotencyKey);
    const requestHash = orderRequestHash(serviceId, normalizedPackageId);
    let contract = await Contract.findOne({ orderReference: reference, client: client._id })
      .select("+orderReference +orderRequestHash");

    if (contract) {
      if (!matchesOrderRequest(contract, serviceId, normalizedPackageId, requestHash)) {
        return res.status(409).json({
          success: false,
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "This checkout key was already used for a different order.",
        });
      }

      contract = await reconcileOrder(contract, req);
      return res.status(200).json({
        success: true,
        message: "The existing demo order was returned safely.",
        data: {
          contract: await populatedContract(contract._id),
          order: { paymentMode: PAYMENT_MODE, paymentStatus: "succeeded", replayed: true },
        },
      });
    }

    const { error: paymentError, payment } = validateMockPayment(rawPayment);
    if (paymentError) {
      return res.status(400).json({ success: false, message: paymentError });
    }

    const service = await Service.findOne({ _id: serviceId, packages: normalizedPackageId })
      .select("freelancer name packages");
    if (!service) {
      return res.status(404).json({ success: false, message: "Service or package not found." });
    }
    if (String(service.freelancer) === String(client._id)) {
      return res.status(403).json({ success: false, message: "You cannot order your own service." });
    }

    const [packageItem, freelancer] = await Promise.all([
      Package.findOne({ _id: normalizedPackageId, freelancer: service.freelancer, isActive: true }),
      User.findOne({ _id: service.freelancer, role: "freelancer", status: "active" })
        .select("role status"),
    ]);
    if (!packageItem) {
      return res.status(404).json({ success: false, message: "This package is not available." });
    }
    if (packageItem.currency !== "BHD") {
      return res.status(422).json({
        success: false,
        code: "PACKAGE_CURRENCY_UNSUPPORTED",
        message: "This legacy package cannot be ordered until its currency is changed to BHD.",
      });
    }
    if (!freelancer) {
      return res.status(422).json({ success: false, message: "This freelancer is not available." });
    }

    const orderAmount = roundMoney(packageItem.price);
    if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
      return res.status(422).json({
        success: false,
        code: "PACKAGE_NOT_ORDERABLE",
        message: "This package needs a positive price before it can be ordered.",
      });
    }

    if (payment.cardNumber === DECLINED_TEST_CARD) {
      return res.status(402).json({
        success: false,
        code: "MOCK_CARD_DECLINED",
        message: "This test card was declined. No order was created.",
      });
    }

    const contractData = buildContractData({
      client,
      freelancer,
      service,
      packageItem,
      reference,
      requestHash,
    });

    let created = true;
    try {
      contract = await createOrderRecords(contractData, req);
    } catch (error) {
      if (error?.code !== 11000) throw error;

      created = false;
      contract = await Contract.findOne({ orderReference: reference, client: client._id })
        .select("+orderReference +orderRequestHash");
      if (!contract) throw error;
      if (!matchesOrderRequest(contract, serviceId, normalizedPackageId, requestHash)) {
        return res.status(409).json({
          success: false,
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "This checkout key was already used for a different order.",
        });
      }
      contract = await reconcileOrder(contract, req);
    }

    return res.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "Demo payment succeeded and the service order is now active."
        : "The existing demo order was returned safely.",
      data: {
        contract: await populatedContract(contract._id),
        order: { paymentMode: PAYMENT_MODE, paymentStatus: "succeeded", replayed: !created },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { createServiceOrder };
