import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Building2,
  Users,
  CreditCard,
  Wrench,
  MessageSquare,
  BarChart3,
  ArrowRight,
  CheckCircle,
} from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"

const features = [
  {
    icon: Building2,
    title: "Property Management",
    description: "Add and manage all your properties with detailed information, track occupancy, and monitor performance.",
  },
  {
    icon: Users,
    title: "Tenant Tracking",
    description: "Maintain a complete tenant database with lease information, contact details, and payment history.",
  },
  {
    icon: CreditCard,
    title: "Rent Collection",
    description: "Record and track rent payments, monitor overdue accounts, and optimize your cash flow.",
  },
  {
    icon: Wrench,
    title: "Maintenance Requests",
    description: "Handle maintenance issues with urgency levels, cost tracking, and status updates.",
  },
  {
    icon: MessageSquare,
    title: "Tenant Communication",
    description: "Send and receive messages from tenants, keeping all communication in one place.",
  },
  {
    icon: BarChart3,
    title: "Revenue Analytics",
    description: "Track gross revenue per property, view payment trends, and monitor your portfolio performance.",
  },
]

const benefits = [
  "Streamlined rent collection and tracking",
  "Centralized property information",
  "Maintenance request management",
  "Tenant communication hub",
  "Real-time occupancy insights",
  "Cash flow optimization",
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <BrandLogo className="h-9" priority />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" asChild>
              <Link href="/auth/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/auth/sign-up">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 lg:py-32">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance">
            Property Management
            <br />
            <span className="text-primary">Simplified</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto text-pretty">
            Optimize cash flow and streamline rent collection with Property HQ.
            Manage properties, track tenants, handle maintenance requests, and
            communicate with tenants - all in one place.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link href="/auth/sign-up">
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/auth/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-card">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">
              Everything You Need to Manage Properties
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              From tracking rent payments to handling maintenance requests,
              Property HQ provides all the tools you need.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border">
                <CardContent className="pt-6">
                  <div className="p-2 bg-primary/10 rounded-lg w-fit mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-6">
                Why Choose Property HQ?
              </h2>
              <p className="text-muted-foreground mb-8">
                Built for property managers and landlords who want to spend less
                time on administration and more time growing their portfolio.
              </p>
              <ul className="space-y-4">
                {benefits.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-card border border-border rounded-2xl p-8">
              <p className="mb-4 text-sm font-medium text-muted-foreground">Example dashboard — illustrative figures, not account data</p>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-background rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly Revenue</p>
                    <p className="text-2xl font-bold">$24,500</p>
                  </div>
                  <div className="text-green-500 text-sm">+12%</div>
                </div>
                <div className="flex items-center justify-between p-4 bg-background rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Occupancy Rate</p>
                    <p className="text-2xl font-bold">94%</p>
                  </div>
                  <div className="text-green-500 text-sm">+3%</div>
                </div>
                <div className="flex items-center justify-between p-4 bg-background rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Properties</p>
                    <p className="text-2xl font-bold">12</p>
                  </div>
                  <div className="text-muted-foreground text-sm">Active</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ready to Streamline Your Property Management?
          </h2>
          <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
            Join property managers who trust Property HQ to handle their portfolio.
            Start your free trial today.
          </p>
          <Button size="lg" variant="secondary" asChild>
            <Link href="/auth/sign-up">
              Get Started Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center">
              <BrandLogo className="h-7" />
            </div>
            <p className="text-sm text-muted-foreground">
              Property Management System
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
