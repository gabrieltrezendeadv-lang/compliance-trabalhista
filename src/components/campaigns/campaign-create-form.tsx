"use client"

import * as React from "react"
import { createCampaign } from "@/lib/campaigns/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface Template {
  id: string
  name: string
  type: string
  channel: string
  subject: string
  body_html: string | null
  body_text: string
  legal_basis: string | null
  requires_acknowledgment: boolean
}

interface CampaignCreateFormProps {
  templates: Template[]
}

const TYPE_OPTIONS = [
  { value: "informational", label: "Informativa" },
  { value: "risk_assessment", label: "Avaliacao de risco" },
  { value: "policy_update", label: "Atualizacao de politica" },
  { value: "training", label: "Treinamento" },
  { value: "legal_notice", label: "Aviso legal" },
  { value: "custom", label: "Personalizada" },
] as const

const CHANNEL_OPTIONS = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "both", label: "E-mail + WhatsApp" },
] as const

export function CampaignCreateForm({ templates }: CampaignCreateFormProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [bodyText, setBodyText] = React.useState("")
  const [bodyHtml, setBodyHtml] = React.useState("")
  const [legalBasis, setLegalBasis] = React.useState("")
  const [requiresAck, setRequiresAck] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  // Prefill fields when a template is selected
  function handleTemplateChange(templateId: string) {
    setSelectedTemplateId(templateId)
    const template = templates.find((t) => t.id === templateId)
    if (template) {
      setSubject(template.subject)
      setBodyText(template.body_text)
      setBodyHtml(template.body_html ?? "")
      setLegalBasis(template.legal_basis ?? "")
      setRequiresAck(template.requires_acknowledgment)
    }
  }

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    setSuccess(false)

    // Set computed fields
    if (selectedTemplateId) {
      formData.set("template_id", selectedTemplateId)
    }
    formData.set("frozen_subject", subject)
    formData.set("frozen_body_html", bodyHtml)
    formData.set("frozen_body_text", bodyText)

    const result = await createCampaign(formData)

    if (result.error) {
      setError(typeof result.error === "string" ? result.error : "Erro ao criar campanha")
      setPending(false)
      return
    }

    setSuccess(true)
    formRef.current?.reset()
    setSelectedTemplateId("")
    setSubject("")
    setBodyText("")
    setBodyHtml("")
    setLegalBasis("")
    setRequiresAck(false)
    setPending(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova Campanha</CardTitle>
        <CardDescription>
          Crie uma campanha de comunicacao para colaboradores.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="camp-name">Nome da Campanha</Label>
            <Input
              id="camp-name"
              name="name"
              required
              minLength={3}
              maxLength={200}
              placeholder="Nome identificador da campanha"
            />
          </div>

          {/* Type and Channel */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select name="type" required>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo da campanha" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Canal de Entrega</Label>
              <Select name="channel" required>
                <SelectTrigger>
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Template selection */}
          <div className="space-y-2">
            <Label>Template (opcional - preenche campos abaixo)</Label>
            <Select
              value={selectedTemplateId}
              onValueChange={handleTemplateChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tmpl) => (
                  <SelectItem key={tmpl.id} value={tmpl.id}>
                    {tmpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="camp-subject">Assunto</Label>
            <Input
              id="camp-subject"
              name="subject"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Assunto do e-mail ou mensagem"
            />
          </div>

          {/* Body text */}
          <div className="space-y-2">
            <Label htmlFor="camp-body-text">Conteudo (texto)</Label>
            <Textarea
              id="camp-body-text"
              name="body_text"
              required
              rows={6}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Conteudo da campanha em texto puro"
            />
          </div>

          {/* Body HTML */}
          <div className="space-y-2">
            <Label htmlFor="camp-body-html">Conteudo HTML (opcional)</Label>
            <Textarea
              id="camp-body-html"
              name="body_html"
              rows={4}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder="Versao HTML do conteudo (para e-mail)"
            />
          </div>

          {/* Legal Basis */}
          <div className="space-y-2">
            <Label htmlFor="camp-legal">Fundamentacao Legal</Label>
            <Input
              id="camp-legal"
              name="legal_basis"
              value={legalBasis}
              onChange={(e) => setLegalBasis(e.target.value)}
              placeholder="Ex: NR-1, CLT Art. 157, LGPD Art. 7"
            />
          </div>

          {/* Requires Acknowledgment */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="camp-ack">Exige ciencia</Label>
              <p className="text-sm text-muted-foreground">
                Destinatarios devem confirmar leitura
              </p>
            </div>
            <Switch
              id="camp-ack"
              name="requires_acknowledgment"
              checked={requiresAck}
              onCheckedChange={setRequiresAck}
            />
          </div>

          {/* Scheduled At */}
          <div className="space-y-2">
            <Label htmlFor="camp-scheduled">
              Agendamento (opcional - deixe vazio para rascunho)
            </Label>
            <Input
              id="camp-scheduled"
              name="scheduled_at"
              type="datetime-local"
            />
          </div>

          {/* Success message */}
          {success && (
            <p className="text-sm text-green-600 dark:text-green-400">
              Campanha criada com sucesso.
            </p>
          )}

          {/* Error display */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Submit */}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Criando..." : "Criar Campanha"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
