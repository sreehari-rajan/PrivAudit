CREATE TABLE "PublicReport" (
    "id" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "removalHash" TEXT NOT NULL,
    CONSTRAINT "PublicReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotaBucket" (
    "key" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuotaBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PublicReport_expiresAt_idx" ON "PublicReport"("expiresAt");
CREATE INDEX "PublicReport_domain_idx" ON "PublicReport"("domain");
CREATE INDEX "QuotaBucket_expiresAt_idx" ON "QuotaBucket"("expiresAt");