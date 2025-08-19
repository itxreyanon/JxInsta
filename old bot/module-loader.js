

import { logger } from '../utils/utils.js';
import fs from 'fs';
import path from 'path';

export class ModuleManager {
  constructor(instagramBot = null, telegramBridge = null) {
    this.modules = [];
    this.commandRegistry = new Map();
    this.instagramBot = instagramBot;
    this.telegramBridge = telegramBridge;
    this.modulesPath = './modules';
  }

  async loadModules() {
    try {
      const moduleFiles = fs.readdirSync(this.modulesPath)
        .filter(file => file.endsWith('.js'))
        .sort();

      for (const file of moduleFiles) {
        await this.loadModule(file);
      }

      this.buildCommandRegistry();
      logger.info(`🔌 Loaded ${this.modules.length} modules`);

    } catch (error) {
      logger.error('Module loading error:', error.message);
    }
  }

  async loadModule(filename) {
    try {
      const modulePath = path.join(this.modulesPath, filename);
      const moduleImport = await import(`../${modulePath}`);
      const ModuleClass = Object.values(moduleImport)[0];
      
      if (!ModuleClass || typeof ModuleClass !== 'function') {
        throw new Error(`No valid module class in ${filename}`);
      }

      let moduleInstance;
      const moduleName = ModuleClass.name;

      if (moduleName === 'CoreModule') {
        moduleInstance = new ModuleClass(this.instagramBot);
      } else if (moduleName === 'HelpModule') {
        moduleInstance = new ModuleClass(this);
      } else {
        moduleInstance = new ModuleClass();
      }

      // Set module manager reference
      moduleInstance.moduleManager = this;
      this.modules.push(moduleInstance);

    } catch (error) {
      logger.error(`Failed to load ${filename}:`, error.message);
    }
  }

  buildCommandRegistry() {
    this.commandRegistry.clear();
    
    for (const module of this.modules) {
      const commands = module.getCommands();
      for (const [name, command] of Object.entries(commands)) {
        this.commandRegistry.set(name.toLowerCase(), {
          ...command,
          module: module,
          moduleName: module.name || module.constructor.name.replace('Module', '').toLowerCase()
        });
      }
    }
  }

  getCommand(name) {
    return this.commandRegistry.get(name.toLowerCase());
  }

  getAllCommands() {
    return this.commandRegistry;
  }

  getModule(name) {
    return this.modules.find(module => 
      module.constructor.name.toLowerCase().includes(name.toLowerCase()) ||
      (module.name && module.name.toLowerCase() === name.toLowerCase())
    );
  }

  async processMessage(message) {
    for (const module of this.modules) {
      try {
        message = await module.process(message);
      } catch (error) {
        // Silent fail for module processing
      }
    }
    return message;
  }

  async cleanup() {
    for (const module of this.modules) {
      if (module.cleanup) {
        await module.cleanup();
      }
    }
    this.modules = [];
    this.commandRegistry.clear();
  }
}
