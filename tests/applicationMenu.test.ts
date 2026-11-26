import { describe, it, expect, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '../src/shared/constants'
import {
  ABOUT_MENU_LABEL,
  aboutPanelOptions,
  applicationMenuTemplate
} from '../src/main/applicationMenu'

function item(
  template: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions | undefined {
  return template.find((entry) => entry.label === label)
}

function submenu(entry: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  return Array.isArray(entry?.submenu) ? entry.submenu : []
}

function labels(entries: MenuItemConstructorOptions[]): string[] {
  return entries.flatMap((entry) => (entry.label ? [entry.label] : []))
}

describe('about panel', () => {
  it('shows j-Tunes and the version passed in', () => {
    expect(aboutPanelOptions('0.2.4')).toEqual({
      applicationName: APP_NAME,
      applicationVersion: '0.2.4'
    })
    expect(APP_NAME).toBe('j-Tunes')
  })
})

describe('application menu', () => {
  const openSettings = vi.fn()
  const showAbout = vi.fn()

  it('keeps About in the macOS app menu and does not add a second one', () => {
    const template = applicationMenuTemplate({
      platform: 'darwin',
      appName: APP_NAME,
      openSettings,
      showAbout
    })

    const appMenu = submenu(item(template, APP_NAME))
    expect(appMenu[0]).toMatchObject({ role: 'about' })
    expect(labels(appMenu)).toContain('Settings…')
    expect(item(template, 'Help')).toBeUndefined()
    expect(labels(template.flatMap((entry) => submenu(entry)))).not.toContain(ABOUT_MENU_LABEL)
  })

  it('puts About in the Help menu on Windows', () => {
    const template = applicationMenuTemplate({
      platform: 'win32',
      appName: APP_NAME,
      openSettings,
      showAbout
    })

    expect(item(template, APP_NAME)).toBeUndefined()
    const help = submenu(item(template, 'Help'))
    expect(help).toEqual([{ label: ABOUT_MENU_LABEL, click: showAbout }])
    expect(labels(submenu(item(template, 'File')))).toContain('Settings…')

    help[0]?.click?.({} as never, undefined, {} as never)
    expect(showAbout).toHaveBeenCalledOnce()
  })
})
