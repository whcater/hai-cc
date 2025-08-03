import Store from 'electron-store'
import { app } from 'electron'
import { EventEmitter } from 'events'

// Claude官方账号信息
export interface ClaudeAccount {
  accountUuid: string
  emailAddress: string
  organizationUuid: string
  organizationRole: string
  workspaceRole: string | null
  organizationName: string
  authorization?: string // 存储从请求中拦截到的 authorization 头
}

// 第三方服务账号信息  
export interface ThirdPartyAccount {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  description?: string
}

// 服务提供方类型
export type ProviderType = 'claude_official' | 'third_party'

// 服务提供方配置
export interface ServiceProvider {
  id: string
  type: ProviderType
  name: string
  accounts: ClaudeAccount[] | ThirdPartyAccount[]
  activeAccountId: string // 当前激活的账号ID
  useProxy: boolean // 是否使用代理，默认true使用全局代理配置
}

export interface AppSettings {
  proxyConfig: {
    enabled: boolean
    url: string
    auth?: {
      username: string
      password: string
    }
  }
  // 废弃的字段，保持兼容性
  apiProviders: Array<{
    id: string
    name: string
    baseUrl: string
    apiKey: string
  }>
  activeProviderId: string

  // 新的服务提供方架构
  serviceProviders: ServiceProvider[]
  activeServiceProviderId: string // 当前激活的服务提供方ID

  terminal: {
    fontSize: number
    fontFamily: string
    theme: 'dark' | 'light'
    skipPermissions: boolean
  }

  // 项目过滤配置
  projectFilter: {
    hiddenDirectories: string[] // 要在项目列表中隐藏的目录名列表
  }
}

const defaultSettings: AppSettings = {
  proxyConfig: {
    enabled: false,
    url: 'http://127.0.0.1:1087'
  },
  // 保持兼容性的废弃字段
  apiProviders: [],
  activeProviderId: '',
  // 新的服务提供方架构
  serviceProviders: [],
  activeServiceProviderId: '',
  terminal: {
    fontSize: 14,
    fontFamily: 'Monaco, Consolas, monospace',
    theme: 'dark',
    skipPermissions: true
  },
  projectFilter: {
    hiddenDirectories: [
      '.git',
      '.svn',
      '.hg',
      'node_modules',
      '.DS_Store',
      '.vscode',
      '.idea',
      'dist',
      'build',
      '.next',
      '.nuxt',
      'coverage',
      '.nyc_output',
      'tmp',
      'temp',
      '.cache',
      '.parcel-cache',
      '.env.local',
      '.env.development.local',
      '.env.test.local',
      '.env.production.local'
    ]
  }
}

export class SettingsManager extends EventEmitter {
  private store: Store<AppSettings>

  constructor() {
    super()
    this.store = new Store<AppSettings>({
      defaults: defaultSettings,
      cwd: app.getPath('userData'),
      name: 'settings'
    })
  }

  getSettings(): AppSettings {
    return this.store.store
  }

  updateSettings(settings: Partial<AppSettings>): void {
    this.store.set(settings as any)
    this.emit('settings:updated', settings)
  }

  getProxyConfig() {
    return this.store.get('proxyConfig')
  }

  updateProxyConfig(config: Partial<AppSettings['proxyConfig']>): void {
    const current = this.store.get('proxyConfig')
    const updated = { ...current, ...config }
    this.store.set('proxyConfig', updated)
    this.emit('proxy:config-updated', updated)
  }

  getActiveProvider() {
    const providerId = this.store.get('activeProviderId')
    const providers = this.store.get('apiProviders')
    return providers.find(p => p.id === providerId)
  }

  setActiveProvider(providerId: string): void {
    this.store.set('activeProviderId', providerId)
    this.emit('provider:changed', providerId)
  }

  // 新的服务提供方管理方法
  getServiceProviders(): ServiceProvider[] {
    return this.store.get('serviceProviders', [])
  }

  addServiceProvider(provider: ServiceProvider): void {
    const providers = this.getServiceProviders()
    const existingIndex = providers.findIndex(p => p.id === provider.id)

    if (existingIndex >= 0) {
      providers[existingIndex] = provider
    } else {
      providers.push(provider)
    }

    this.store.set('serviceProviders', providers)
    this.emit('service-providers:updated', providers)
  }

  removeServiceProvider(providerId: string): void {
    const providers = this.getServiceProviders().filter(p => p.id !== providerId)
    this.store.set('serviceProviders', providers)

    // 如果删除的是当前活动的提供方，清空活动ID
    if (this.store.get('activeServiceProviderId') === providerId) {
      this.store.set('activeServiceProviderId', '')
    }

    this.emit('service-providers:updated', providers)
  }

  getActiveServiceProvider(): ServiceProvider | undefined {
    const providerId = this.store.get('activeServiceProviderId')
    const providers = this.getServiceProviders()
    return providers.find(p => p.id === providerId)
  }

  setActiveServiceProvider(providerId: string): void {
    this.store.set('activeServiceProviderId', providerId)
    this.emit('active-service-provider:changed', providerId)
  }

  // Claude官方账号管理
  updateClaudeAccounts(accounts: ClaudeAccount[]): void {
    const providers = this.getServiceProviders()
    let claudeProvider = providers.find(p => p.type === 'claude_official')

    if (!claudeProvider) {
      claudeProvider = {
        id: 'claude_official',
        type: 'claude_official',
        name: 'Claude Official',
        accounts: [],
        activeAccountId: '',
        useProxy: true // 默认使用代理
      }
    }

    // 保留所有现有账号，只新增不存在的账号
    const existingAccounts = claudeProvider.accounts as ClaudeAccount[]
    const updatedAccounts = [...existingAccounts]

    // 添加新账号（不存在的账号）
    accounts.forEach(newAccount => {
      const existingIndex = updatedAccounts.findIndex(existing =>
        existing.emailAddress === newAccount.emailAddress
      )

      if (existingIndex >= 0) {
        // 更新现有账号的基本信息，保留authorization
        updatedAccounts[existingIndex] = {
          ...newAccount,
          authorization: updatedAccounts[existingIndex].authorization || newAccount.authorization
        }
      } else {
        // 添加新账号
        updatedAccounts.push(newAccount)
      }
    })

    claudeProvider.accounts = updatedAccounts

    // 如果当前活动账号不存在了，清空或设置为第一个
    if (!accounts.find(acc => acc.emailAddress === claudeProvider.activeAccountId)) {
      claudeProvider.activeAccountId = accounts.length > 0 ? accounts[0].emailAddress : ''
    }

    this.addServiceProvider(claudeProvider)
  }

  // 第三方账号管理
  addThirdPartyAccount(providerId: string, account: ThirdPartyAccount): void {
    const providers = this.getServiceProviders()
    let provider = providers.find(p => p.id === providerId)

    if (!provider) {
      provider = {
        id: providerId,
        type: 'third_party',
        name: account.name,
        accounts: [],
        activeAccountId: '',
        useProxy: true // 默认使用代理
      }
    }

    const accounts = provider.accounts as ThirdPartyAccount[]
    const existingIndex = accounts.findIndex(acc => acc.id === account.id)

    if (existingIndex >= 0) {
      accounts[existingIndex] = account
    } else {
      accounts.push(account)
    }

    if (!provider.activeAccountId && accounts.length > 0) {
      provider.activeAccountId = accounts[0].id
    }

    this.addServiceProvider(provider)
  }

  removeThirdPartyAccount(providerId: string, accountId: string): void {
    const providers = this.getServiceProviders()
    const provider = providers.find(p => p.id === providerId)

    if (!provider) return

    const accounts = provider.accounts as ThirdPartyAccount[]
    provider.accounts = accounts.filter(acc => acc.id !== accountId)

    // 如果删除的是当前活动账号，设置为第一个或清空
    if (provider.activeAccountId === accountId) {
      provider.activeAccountId = provider.accounts.length > 0 ? (provider.accounts[0] as ThirdPartyAccount).id : ''
    }

    this.addServiceProvider(provider)
  }

  setActiveAccount(providerId: string, accountId: string): void {
    const providers = this.getServiceProviders()
    const provider = providers.find(p => p.id === providerId)

    if (provider) {
      provider.activeAccountId = accountId
      this.addServiceProvider(provider)
      this.setActiveServiceProvider(providerId)
      this.emit('active-account:changed', { providerId, accountId })
    }
  }

  getCurrentActiveAccount(): { provider: ServiceProvider, account: ClaudeAccount | ThirdPartyAccount } | null {
    const activeProvider = this.getActiveServiceProvider()
    if (!activeProvider || !activeProvider.activeAccountId) {
      return null
    }

    const account = activeProvider.accounts.find(acc => {
      if (activeProvider.type === 'claude_official') {
        return (acc as ClaudeAccount).emailAddress === activeProvider.activeAccountId
      } else {
        return (acc as ThirdPartyAccount).id === activeProvider.activeAccountId
      }
    })

    if (!account) return null

    return { provider: activeProvider, account }
  }

  // 设置服务提供方的代理使用状态
  setProviderProxyUsage(providerId: string, useProxy: boolean): void {
    const providers = this.getServiceProviders()
    const provider = providers.find(p => p.id === providerId)

    if (provider) {
      provider.useProxy = useProxy
      this.addServiceProvider(provider)
      this.emit('provider-proxy:changed', { providerId, useProxy })
    }
  }

  // 获取当前活动服务提供方的代理使用状态
  shouldUseProxyForCurrentProvider(): boolean {
    const activeProvider = this.getActiveServiceProvider()
    if (!activeProvider) {
      return true // 默认使用代理
    }
    return activeProvider.useProxy
  }

  // 刷新Claude账号（重新读取.claude.json文件）
  async refreshClaudeAccounts(): Promise<ClaudeAccount[]> {
    const accounts = await this.readClaudeAccountsFromConfig()
    this.updateClaudeAccounts(accounts)
    return accounts
  }

  // 更新Claude账号的authorization值
  updateClaudeAccountAuthorization(emailAddress: string, authorization: string): void {
    const providers = this.getServiceProviders()
    const claudeProvider = providers.find(p => p.type === 'claude_official')

    if (!claudeProvider) return

    const accounts = claudeProvider.accounts as ClaudeAccount[]
    const account = accounts.find(acc => acc.emailAddress === emailAddress)

    if (account) {
      account.authorization = authorization
      this.addServiceProvider(claudeProvider)
      this.emit('claude-account-auth:updated', { emailAddress, authorization })
    }
  }

  // 根据authorization值查找Claude账号
  findClaudeAccountByAuthorization(authorization: string): ClaudeAccount | null {
    const providers = this.getServiceProviders()
    const claudeProvider = providers.find(p => p.type === 'claude_official')

    if (!claudeProvider) return null

    const accounts = claudeProvider.accounts as ClaudeAccount[]
    return accounts.find(acc => acc.authorization === authorization) || null
  }

  // 获取项目过滤配置
  getProjectFilterConfig() {
    return this.store.get('projectFilter', defaultSettings.projectFilter)
  }

  // 更新项目过滤配置
  updateProjectFilterConfig(config: Partial<AppSettings['projectFilter']>): void {
    const current = this.store.get('projectFilter', defaultSettings.projectFilter)
    const updated = { ...current, ...config }
    this.store.set('projectFilter', updated)
    this.emit('project-filter:updated', updated)
  }

  // 检查目录是否应该被隐藏
  shouldHideDirectory(directoryPath: string): boolean {
    const config = this.getProjectFilterConfig()
    const directoryName = require('path').basename(directoryPath)

    // 检查是否在隐藏列表中
    return config.hiddenDirectories.includes(directoryName) ||
      config.hiddenDirectories.some(pattern => {
        // 支持简单的模式匹配，以点开头的目录
        if (pattern.startsWith('.') && directoryName.startsWith('.')) {
          return directoryName === pattern
        }
        return directoryName === pattern
      })
  }

  // 获取终端配置
  getTerminalConfig() {
    return this.store.get('terminal', defaultSettings.terminal)
  }

  // 更新终端配置
  updateTerminalConfig(config: Partial<AppSettings['terminal']>): void {
    const current = this.store.get('terminal', defaultSettings.terminal)
    const updated = { ...current, ...config }
    this.store.set('terminal', updated)
    this.emit('terminal:config-updated', updated)
  }

  // 获取是否跳过权限检查
  getSkipPermissions(): boolean {
    return this.store.get('terminal.skipPermissions', defaultSettings.terminal.skipPermissions)
  }

  // 设置是否跳过权限检查
  setSkipPermissions(skipPermissions: boolean): void {
    this.updateTerminalConfig({ skipPermissions })
  }

  // 导出配置到文件
  async exportSettings(filePath: string, includeSensitiveData = false): Promise<{ success: boolean, error?: string }> {
    try {
      const fs = require('fs').promises
      
      // 获取当前所有设置
      const settings = this.getSettings()
      
      // 创建导出数据结构
      const exportData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        includeSensitiveData: includeSensitiveData,
        settings: {
          proxyConfig: {
            enabled: settings.proxyConfig.enabled,
            url: settings.proxyConfig.url,
            // 根据选项决定是否导出代理认证信息
            ...(includeSensitiveData && settings.proxyConfig.auth ? {
              auth: {
                username: this.encodeData(settings.proxyConfig.auth.username || ''),
                password: this.encodeData(settings.proxyConfig.auth.password || '')
              }
            } : {})
          },
          terminal: settings.terminal,
          projectFilter: settings.projectFilter,
          serviceProviders: settings.serviceProviders.map(provider => {
            if (provider.type === 'claude_official') {
              return {
                id: provider.id,
                type: provider.type,
                name: provider.name,
                useProxy: provider.useProxy,
                activeAccountId: provider.activeAccountId,
                accounts: (provider.accounts as ClaudeAccount[]).map(account => ({
                  accountUuid: account.accountUuid,
                  emailAddress: account.emailAddress,
                  organizationUuid: account.organizationUuid,
                  organizationRole: account.organizationRole,
                  workspaceRole: account.workspaceRole,
                  organizationName: account.organizationName,
                  // 根据选项决定是否导出 authorization 敏感信息
                  ...(includeSensitiveData && account.authorization ? {
                    authorization: this.encodeData(account.authorization)
                  } : {})
                }))
              }
            } else {
              return {
                id: provider.id,
                type: provider.type,
                name: provider.name,
                useProxy: provider.useProxy,
                activeAccountId: provider.activeAccountId,
                accounts: (provider.accounts as ThirdPartyAccount[]).map(account => ({
                  id: account.id,
                  name: account.name,
                  baseUrl: account.baseUrl,
                  description: account.description,
                  // 根据选项决定是否导出 apiKey 敏感信息
                  ...(includeSensitiveData && account.apiKey ? {
                    apiKey: this.encodeData(account.apiKey)
                  } : {})
                }))
              }
            }
          })
        }
      }
      
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
      return { success: true }
    } catch (error) {
      console.error('导出配置失败:', error)
      return { success: false, error: (error as Error).message }
    }
  }

  // 从文件导入配置
  async importSettings(filePath: string): Promise<{ success: boolean, error?: string, imported?: string[] }> {
    try {
      const fs = require('fs').promises
      
      // 读取配置文件
      const configData = await fs.readFile(filePath, 'utf-8')
      const importData = JSON.parse(configData)
      
      // 验证文件格式
      if (!importData.version || !importData.settings) {
        return { success: false, error: '配置文件格式无效' }
      }
      
      const imported: string[] = []
      const importSettings = importData.settings
      const hasSensitiveData = importData.includeSensitiveData === true
      
      // 导入代理配置
      if (importSettings.proxyConfig) {
        const proxyConfig: any = {
          enabled: importSettings.proxyConfig.enabled,
          url: importSettings.proxyConfig.url
        }
        
        // 如果包含敏感数据，导入认证信息
        if (hasSensitiveData && importSettings.proxyConfig.auth) {
          proxyConfig.auth = {
            username: this.decodeData(importSettings.proxyConfig.auth.username || ''),
            password: this.decodeData(importSettings.proxyConfig.auth.password || '')
          }
        }
        
        this.updateProxyConfig(proxyConfig)
        imported.push('代理配置' + (hasSensitiveData ? '（包含认证信息）' : ''))
      }
      
      // 导入终端配置
      if (importSettings.terminal) {
        this.updateTerminalConfig(importSettings.terminal)
        imported.push('终端配置')
      }
      
      // 导入项目过滤配置
      if (importSettings.projectFilter) {
        this.updateProjectFilterConfig(importSettings.projectFilter)
        imported.push('项目过滤配置')
      }
      
      // 导入服务提供商配置和账号信息
      if (importSettings.serviceProviders && Array.isArray(importSettings.serviceProviders)) {
        let importedAccountsCount = 0
        let importedSensitiveCount = 0
        
        for (const importedProvider of importSettings.serviceProviders) {
          if (importedProvider.type === 'claude_official' && importedProvider.accounts) {
            // 导入Claude官方账号
            const claudeAccounts: ClaudeAccount[] = importedProvider.accounts.map((account: any) => ({
              accountUuid: account.accountUuid,
              emailAddress: account.emailAddress,
              organizationUuid: account.organizationUuid,
              organizationRole: account.organizationRole,
              workspaceRole: account.workspaceRole,
              organizationName: account.organizationName,
              // 如果包含敏感数据且有authorization，解码后导入
              ...(hasSensitiveData && account.authorization ? {
                authorization: this.decodeData(account.authorization)
              } : {})
            }))
            
            this.updateClaudeAccounts(claudeAccounts)
            importedAccountsCount += claudeAccounts.length
            if (hasSensitiveData) {
              importedSensitiveCount += claudeAccounts.filter(acc => acc.authorization).length
            }
          } else if (importedProvider.type === 'third_party' && importedProvider.accounts) {
            // 导入第三方账号
            for (const account of importedProvider.accounts) {
              if (account.id && account.name && account.baseUrl) {
                const thirdPartyAccount: ThirdPartyAccount = {
                  id: account.id,
                  name: account.name,
                  baseUrl: account.baseUrl,
                  description: account.description || '',
                  // 如果包含敏感数据且有apiKey，解码后导入
                  apiKey: (hasSensitiveData && account.apiKey) 
                    ? this.decodeData(account.apiKey) 
                    : ''
                }
                this.addThirdPartyAccount(importedProvider.id, thirdPartyAccount)
                importedAccountsCount++
                if (hasSensitiveData && account.apiKey) {
                  importedSensitiveCount++
                }
              }
            }
          }
        }
        
        if (importedAccountsCount > 0) {
          let accountMessage = `账号配置 (${importedAccountsCount}个账号)`
          if (hasSensitiveData && importedSensitiveCount > 0) {
            accountMessage += `，包含${importedSensitiveCount}个账号的敏感信息`
          }
          imported.push(accountMessage)
        }
      }
      
      this.emit('settings:imported', { imported })
      return { success: true, imported }
    } catch (error) {
      console.error('导入配置失败:', error)
      return { success: false, error: (error as Error).message }
    }
  }

  // 编码敏感数据（简单Base64编码）
  private encodeData(data: string): string {
    if (!data) return ''
    return Buffer.from(data, 'utf-8').toString('base64')
  }

  // 解码敏感数据
  private decodeData(encodedData: string): string {
    if (!encodedData) return ''
    try {
      return Buffer.from(encodedData, 'base64').toString('utf-8')
    } catch (error) {
      console.warn('解码数据失败:', error)
      return ''
    }
  }

  // 读取Claude配置文件
  private async readClaudeAccountsFromConfig(): Promise<ClaudeAccount[]> {
    const os = require('os')
    const fs = require('fs').promises
    const path = require('path')

    try {
      const claudeConfigPath = path.join(os.homedir(), '.claude.json')
      const configData = await fs.readFile(claudeConfigPath, 'utf-8')
      const config = JSON.parse(configData)

      if (config.oauthAccount) {
        return [config.oauthAccount as ClaudeAccount]
      }

      return []
    } catch (error) {
      console.warn('无法读取Claude配置文件:', error)
      return []
    }
  }
}