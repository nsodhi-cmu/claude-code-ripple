import { emailReceipt } from '../src/email'
import { assertEqual } from './assert'

assertEqual(
  emailReceipt({ to: 'ada@example.com', total: 30, currency: 'USD' }),
  'To: ada@example.com\nThanks! You paid $30.00.',
  'emailReceipt',
)
