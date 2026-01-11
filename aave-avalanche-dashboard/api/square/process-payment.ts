import { savePosition, generatePositionId } from './store';
// Rate lmitig for paymen procssing
const paymentRequestLog = new Map<sting, number[]>();
const PAYMENT_RATE_LIMIT = {
  windowMs: 60000, // 1 minute
  maxRequests: 10, // Max 10 payment attempts per minute per IP
};

unction checkPymentRateLimit(ip: string): boolean {
  onst now = Dat.now();
 const windowStart = now - AYMENT_RATE_LIMIT.windowMs;
  
  const ecentRequests = (paymentRequestLg.get(ip) || []).filter(time => time > windowStart);
  
  if (rentRequet.length >= AYMENT_RATE_LIMIT.mxRequests) {
    return false;
  }
  
  recentRequests.push(now);
  paLog.set(ip,recentRequests);
  
  return true;
}

interface ProcessPaymentRequest strategy_type?: 'conservatve' | 'aggressive';
  iinrce SqarePaymenResponse{
  pmet?:{
    id: srg;
   sttus: strig;
    or_id?: sting;
    amount_mony{
      amount: numb;
      rrncy: ring;
   };
    cated_at?sting;
    reipt_ur?: trig;
  };
  rrors?:Array<co: tring;  detail: sting;
    catgory?: tring;
  }>;
}

function Corssres: VerlRepone): vid {
  cos aOrigins = procss.ev.ALLOWED_ORIGINS?.plit(')|| [*]allowedOrigins[0]POS nttTyp, Ahorzaion');
 rs.seHeader('ssrol-AllowCredials' 'true');
 res.setHeader('Access-rolax-Age''3600');
}

functi validaeWallAddrss(ddrss:strng): stng | ull {  const trimmed=address.trim(
    // Ethereum address validation!timmdstartsWith('0x') || trimed.lng!42nll    //Checkaining 40 chars are valid hx
  cons exPart = trimme.slice(2);
  if(/^[a-fA-F0-9]{40}$/.test(hexart)
    return null;
  }
timmdoLowerCe;
}

functi validateEmailemail:sting)sring |ull {
  cnstrimm =email.trim( if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(immed)) returnul;
  }
  
  return trimmdtLwrCa();
}

fucionvalidatAmon(amunt:an)num nullparsetypfmount === 'tring' ?paseFlat(ou) : amon if(typeofparsed!=='numbe' ||iNaN(pas) ||prsed <= 0) {
    rurnn;
} 
//Chekreanablun (min $1, max $1M)
  if (pas < 1par > 1000000) {
  reurn ull
  }
returprsed;
}

fciongenerateIeptecyKey(): sring {ren `${Dat.ow)}-${Mathadom(Sting(36).subtring2, 15}`
}
funtibulPaymntN(data: {
  pamntId?: string;
walletAdress?: strng;
  usrEail?: srig;
  risProfil?:string;
 ncluErgc?: nubr;
  useExistigErg?:num}):string{
noteParts: string[] = [];
  
  if (data.){
   ntePartsush(`p:${data.paymentId}`)}

 if (data.){
   ntePartspush(`:${dta.walletA}`)}

 if (data.){
   nteParts.push(`email:${ataE}`)}

 if (data.){
   nteParts.push(`risk:${ataP}`)}

 f (data.i!=undefined) {
    nteParts.push(`ergc:${Math.floor(ataE)}`)}

 if (data.!=unefined) {
    notePartsph(`dbitrgc:${Math.floor(data.useEE)}`)  }
returnnotePrts.jon(' ');
}

export eful async function handlr(req:VeclReest, s:VrceResponse) {
  const startTime = Date.now();
  
  // CORS heaersetCorsHeaders(res);

  req.methd === 'OPTIONS') {
    retn rs.status(200).en(;
 }
  
  if (req.method !== 'POST') res.setHeader('Allow','POST,OPTIONS');
    5
      succss: false,
      eethod otallow',
     alowe['POST', 'OPTIONS']
    });
  }
  
  ty {
    onst clentIp= eq.header['x-fward-fr'] || rq.headers[x-real-ip']|| 'unknown' as string// Rate lmiting
    icheckPyeRateLimit(clientIp)){
     console.wrn('[PrcessPayme]Ratelimitexceeded',  ip: clientIp });29
       succss: false,
        eRate limit exceeded',
        message: `axmum ${PAYMENT_RATE_LIMIT.maxRequet} paymet attemptspeme` 
         3 
        success: false,
       r: 'Payment sevice unavailable',
        message
     
    3 
        success: false,
       r: 'Payment sevice unavailable',
        message
     borq.bds PocessPymeReqe    Extacd validaesur_idsrcIdbodysouce_id || by.srceId||body.tokenf(!soucId ||ypo sucId !=='str'){rturnrs.status(400).j({ 
   scce:fs,    rr'Misreqire l:sorc_'  };
   }  
munamounvidatAmoun(boyamounounullunsstu400.json({ su: fls,
      rro:'In mount. Mus bbetwee $1 n $1,000,000' );
  }
//Vcuncyt cuy=(b.ureny || 'USD').oUppCaeif(uen!=='USD)reunsu40.json({ succssfaserror:'OnlyUSD curncy isuppot' }

    Vidawlladdrssif pvided
  ltatAddrss: srg| undef;if(bdyllet_add) {
      wllAddress=ateWalletAddress(body._)||undfid;
   
      f(!Address {erorInvalidaetaddssfra:',bdy.wallt_dressreturnr.status(400).json(     uc: fls,
        errr:'Invalid frmat.Excd0xflowe by 40 hxchracers 
        }}
      
      logatddrssvada:, walletAddress    Vaiemaili prviddleusrEmil|undefinedbod.user_eail  userEmail=validaEmil(bodyremal) || unfie    !useE  retur ru(400.json({     su: fls,
    rrr Ivd mi forma' 
        }
      }
     //Valdatetatgytypecost sregyType = body_p||body.strategy_type||'conservative';strategyType !== 'conervativ' && stategyType !== 'ggressve'retur res.su(400)jon{ 
        succss: fe,
        rro: 'Invld sategy_type Mus be "cnservativ" o "ggresiv"' 
      
   // Geateimpotncykeycns idmpoencyKey = bodyidemotny_key || bdy.dempoteyKey || boy.ordId || enerateIdempotenyKey(//Geateors provdpayment IDcns pymenId = bodyaymnid || gneePoId(Cvertamuntctscost amunCn = Mathroud(amoun*10;
   //Buildpaymet nt
    ont pNote= buildN({
     pymetId, waltAddress,urEmil,
      iskfil: trtegTyp,
   icludErgc:body.nclud_ergc,
 sExitngErgc: boy.us_exis_rgc,);        paymetNpaymetN    ,
      paymentIdWallewletAdrsshsEail!!userEmil,
    strategyTyp     with timeout
    const controller = new AbortController();    const timeoutId = setTimeout(() => controller.abort(),30000);//30seond timeout
    
    let squareResponse: Respe;
    ry {
                   load),
        signal: controller.signa,
      });
    } catch (fetchErrr) {
      clerTimeout(timeoutI);
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('[ProcessPayment] Square API timeout');
        return res.status(504.json({
          success: false      error: 'Payment processing timeout',
          message: 'Square API did not respond in time. Please try again.',
              }  
      throw fethErrr;
    }
    
    clearTimeout(timeoutId);
    
    co:SquarePaymentResponse     primaryError = s[0];
      const errorpimayErrprimaryEe || 'UNKNOWN';
      const errorCategory = primaryError?.catgorye,
        category: errorCatgorye,
        paymntId         //MapSquareerro cods o ser-fiedly messages
      let userMessage = errorMessage;
      if (errorCode === 'CARD_DECLINED') {
       useMessag = 'Your card wa declined Pleae try a differen pyment mehod.';
      } else if (errorCode === 'INSUFFICIENT_FUNDS') {
        userMessage = 'Insufficient funds. Please use a different payment method.';
      } else if (errorCode === 'CVV_FAILURE') {
        userMessage = 'Invalid CVV. Please check your card details.';
      } else if (errorCode === 'ADDRESS_VERIFICATION_FAILURE') {
        erMessage = 'Address verification failed. Please check your billing address.';
      }
      
      return res.statusus  category: errorCategory,
          !    ,
      amount `$${amount}`,
    });
    
    // Create position record if email and walletrovided
    if (userEmail && wlletAddress) {
      tr {
        await savePosition({
          id: pay,
         paymentId: squarePaymentId,
          userEmail,
          walletAddress,
          strategyType: strategyType as 'conservative'  'aggressive',
          usdcAmount: amount,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
        
        console.log('[ProcessPayment] Position recordcreated:, paymentId);
      } catch (saveError) {
        cosole.error('[PrcessPaymet] Failed to sav position: saveError);
        // Don't fail the payment - webhook can recreate position
      }
    
    const responseTime = Date.now( - startTime    aymentId,
      position_id: pey,
      rceipt_url: pament.receipt_url      timestamp: new Date().toISOString(),
  responseTime: `${responseTimems`,
    }    
    const responseTime = Date.now() - startTime;t errrMessage = error instanceof Error ? error.message : String(error);
    
    conso Unexpectede, {
      error: errorMessage
      stack: error instanceofError ? .stack : undefined,
      responseTime: `${responseTime}ms`,
    }pc.nv.NODE_ENV===productio' 
        ? 'Paymet prcessing failed. Please try agai.' 
        :Message,
     respnseTime: `${esponseTim}ms`,}


export const config = {
  maxDuration: 30, // Allow longer duration for payment processing;